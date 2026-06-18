const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const SUPPORTED_COMMANDS = new Set(["foreground", "start", "status", "stop"]);
const PENPOT_ARGS = ["-y", "@penpot/mcp@latest"];
const NPM_REGISTRY = "https://registry.npmjs.org/";
const MCP_URL = "http://localhost:4401/mcp";
const PLUGIN_URL = "http://localhost:4400/manifest.json";
const STARTUP_WAIT_MS = 60000;
const STARTUP_POLL_MS = 1000;

function createPaths(rootDir) {
  const runtimeDir = path.join(rootDir, "artifacts", "penpot-mcp");
  return {
    runtimeDir,
    npmCacheDir: path.join(runtimeDir, "npm-cache"),
    stateFile: path.join(runtimeDir, "server.json"),
    logFile: path.join(runtimeDir, "server.log"),
  };
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteCmdPath(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function createPenpotEnvironment(paths) {
  return {
    npm_config_cache: paths.npmCacheDir,
    npm_config_registry: NPM_REGISTRY,
    PNPM_CONFIG_REGISTRY: NPM_REGISTRY,
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS: "true",
  };
}

function createWindowsCommandLine(args, paths, options = {}) {
  const redirect = options.redirect !== false;
  const npxCommand = `npx --registry ${NPM_REGISTRY} ${args.join(" ")}`;
  const commandParts = [
    `set "npm_config_cache=${paths.npmCacheDir}"`,
    `set "npm_config_registry=${NPM_REGISTRY}"`,
    `set "PNPM_CONFIG_REGISTRY=${NPM_REGISTRY}"`,
    'set "PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true"',
    redirect ? `${npxCommand} 1>> ${quoteCmdPath(paths.logFile)} 2>&1` : npxCommand,
  ];
  return commandParts.join(" && ");
}

function createLaunchSpec(platform = process.platform, args = PENPOT_ARGS, paths, rootDir = process.cwd()) {
  const env = createPenpotEnvironment(paths);

  if (platform === "win32") {
    const commandLine = createWindowsCommandLine(args, paths);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$commandLine = ${quotePowerShellString(commandLine)}`,
      "$process = Start-Process -FilePath 'cmd.exe' " +
        "-ArgumentList @('/d','/s','/c',$commandLine) " +
        `-WorkingDirectory ${quotePowerShellString(rootDir)} ` +
        "-WindowStyle Hidden -PassThru",
      "Write-Output $process.Id",
    ].join("; ");

    return {
      mode: "powershell-start-process",
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      env,
    };
  }

  return {
    mode: "detached-spawn",
    command: "npx",
    args: ["--registry", NPM_REGISTRY, ...args],
    env,
  };
}

function createStopSpec(platform = process.platform, pid) {
  if (platform === "win32") {
    return {
      command: "taskkill",
      args: ["/PID", String(pid), "/T", "/F"],
    };
  }

  return {
    command: "kill",
    args: ["-TERM", String(pid)],
  };
}

function parseCommand(argv) {
  const command = argv[0] || "status";
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `Unsupported Penpot MCP service command: ${command}. Use foreground, start, status, or stop.`
    );
  }
  return command;
}

function ensureRuntimeDir(paths) {
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
}

function readState(paths) {
  if (!fs.existsSync(paths.stateFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(paths.stateFile, "utf8"));
  } catch (error) {
    return {
      invalid: true,
      error: error.message,
    };
  }
}

function writeState(paths, state) {
  fs.writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function removeState(paths) {
  if (fs.existsSync(paths.stateFile)) {
    fs.unlinkSync(paths.stateFile);
  }
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function requestUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 500,
        statusCode: res.statusCode,
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });

    req.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForService(pid, timeoutMs = STARTUP_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastMcp = { ok: false, error: "not checked" };
  let lastPlugin = { ok: false, error: "not checked" };

  while (Date.now() <= deadline) {
    const pidRunning = isPidRunning(pid);
    lastMcp = await requestUrl(MCP_URL, 1000);
    lastPlugin = await requestUrl(PLUGIN_URL, 1000);

    if (pidRunning && lastMcp.ok && lastPlugin.ok) {
      return { ready: true, pidRunning, mcp: lastMcp, plugin: lastPlugin };
    }

    if (!pidRunning) {
      return { ready: false, pidRunning, mcp: lastMcp, plugin: lastPlugin };
    }

    await delay(STARTUP_POLL_MS);
  }

  return {
    ready: false,
    pidRunning: isPidRunning(pid),
    mcp: lastMcp,
    plugin: lastPlugin,
  };
}

function readLogTail(paths, maxLines = 80) {
  if (!fs.existsSync(paths.logFile)) {
    return [];
  }

  const content = fs.readFileSync(paths.logFile, "utf8");
  return content.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function shouldResetNpmCacheAfterStartFailure(service, attempt) {
  return attempt === 0 && !service.pidRunning;
}

function resetNpmCache(paths) {
  if (fs.existsSync(paths.npmCacheDir)) {
    fs.rmSync(paths.npmCacheDir, { recursive: true, force: true });
  }
}

function launchDetachedProcess(paths) {
  const spec = createLaunchSpec(process.platform, PENPOT_ARGS, paths, process.cwd());

  if (spec.mode === "powershell-start-process") {
    const result = spawnSync(spec.command, spec.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...spec.env },
      windowsHide: true,
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = result.stderr ? result.stderr.trim() : "";
      const stdout = result.stdout ? result.stdout.trim() : "";
      throw new Error(`Failed to start hidden Penpot MCP process. ${stderr || stdout}`);
    }

    const pidMatch = result.stdout.match(/\d+/);
    if (!pidMatch) {
      throw new Error("Failed to read Penpot MCP process ID from PowerShell.");
    }

    return {
      pid: Number.parseInt(pidMatch[0], 10),
      command: spec.command,
      args: spec.args,
    };
  }

  const out = fs.openSync(paths.logFile, "a");
  const err = fs.openSync(paths.logFile, "a");
  try {
    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      detached: true,
      env: { ...process.env, ...spec.env },
      stdio: ["ignore", out, err],
      windowsHide: true,
    });

    child.unref();
    return {
      pid: child.pid,
      command: spec.command,
      args: spec.args,
    };
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
}

async function runForeground(paths) {
  ensureRuntimeDir(paths);

  if (process.platform === "win32") {
    const commandLine = createWindowsCommandLine(PENPOT_ARGS, paths, { redirect: false });
    const child = spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: process.cwd(),
      env: { ...process.env, ...createPenpotEnvironment(paths) },
      stdio: "inherit",
      windowsHide: false,
    });

    return new Promise((resolve) => {
      child.on("exit", (code) => resolve(code || 0));
      child.on("error", () => resolve(1));
    });
  }

  const spec = createLaunchSpec(process.platform, PENPOT_ARGS, paths, process.cwd());
  const child = spawn(spec.command, spec.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...spec.env },
    stdio: "inherit",
  });

  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code || 0));
    child.on("error", () => resolve(1));
  });
}

async function startService(paths, attempt = 0) {
  ensureRuntimeDir(paths);

  const existing = readState(paths);
  if (existing && isPidRunning(existing.pid)) {
    console.log(`[INFO] Penpot MCP server is already running. PID: ${existing.pid}`);
    console.log(`[INFO] Log: ${paths.logFile}`);
    return 0;
  }

  const launched = launchDetachedProcess(paths);

  writeState(paths, {
    pid: launched.pid,
    command: launched.command,
    args: launched.args,
    mcpUrl: MCP_URL,
    pluginUrl: PLUGIN_URL,
    logFile: paths.logFile,
    startedAt: new Date().toISOString(),
  });

  console.log(`[INFO] Started hidden Penpot MCP process. PID: ${launched.pid}`);
  console.log(`[INFO] MCP endpoint: ${MCP_URL}`);
  console.log(`[INFO] Plugin manifest: ${PLUGIN_URL}`);
  console.log(`[INFO] Log: ${paths.logFile}`);

  const service = await waitForService(launched.pid);
  if (service.ready) {
    console.log("[OK] Penpot MCP server is reachable.");
    return 0;
  }

  console.log("[ERROR] Penpot MCP server did not become reachable.");
  console.log(`[INFO] PID: ${launched.pid} (${service.pidRunning ? "running" : "not running"})`);
  console.log(`[INFO] MCP endpoint: ${service.mcp.ok ? "reachable" : "not reachable"}`);
  console.log(`[INFO] Plugin manifest: ${service.plugin.ok ? "reachable" : "not reachable"}`);
  const logLines = readLogTail(paths);
  if (logLines.length > 0) {
    console.log("[INFO] Recent Penpot MCP log:");
    for (const line of logLines) {
      console.log(line);
    }
  }
  if (!service.pidRunning) {
    removeState(paths);
  }
  if (shouldResetNpmCacheAfterStartFailure(service, attempt)) {
    console.log("[INFO] Resetting Penpot MCP npm cache and retrying once.");
    resetNpmCache(paths);
    return startService(paths, attempt + 1);
  }
  return 1;
}

async function stopService(paths) {
  const state = readState(paths);
  if (!state || !state.pid) {
    console.log("[INFO] No Penpot MCP server state file found.");
    return 0;
  }

  if (!isPidRunning(state.pid)) {
    removeState(paths);
    console.log(`[INFO] Stored Penpot MCP PID is not running: ${state.pid}`);
    return 0;
  }

  const stopped = await new Promise((resolve) => {
    if (process.platform === "win32") {
      const spec = createStopSpec(process.platform, state.pid);
      const taskkill = spawn(spec.command, spec.args, {
        stdio: "inherit",
        windowsHide: true,
      });
      taskkill.on("exit", (code) => resolve(code === 0));
      taskkill.on("error", () => resolve(false));
      return;
    }

    try {
      process.kill(-state.pid, "SIGTERM");
    } catch (error) {
      try {
        process.kill(state.pid, "SIGTERM");
      } catch (innerError) {
        // The status check below handles stale process state.
      }
    }
    resolve(true);
  });

  if (!stopped) {
    console.log(`[ERROR] Failed to stop Penpot MCP server. PID: ${state.pid}`);
    return 1;
  }

  removeState(paths);
  console.log(`[OK] Stopped Penpot MCP server. PID: ${state.pid}`);
  return 0;
}

async function statusService(paths) {
  const state = readState(paths);
  if (!state || !state.pid) {
    console.log("[INFO] Penpot MCP server is not tracked as running.");
    return 1;
  }

  const pidRunning = isPidRunning(state.pid);
  const mcp = await requestUrl(MCP_URL);
  const plugin = await requestUrl(PLUGIN_URL);

  console.log(`[INFO] PID: ${state.pid} (${pidRunning ? "running" : "not running"})`);
  console.log(`[INFO] MCP endpoint: ${MCP_URL} (${mcp.ok ? "reachable" : "not reachable"})`);
  console.log(`[INFO] Plugin manifest: ${PLUGIN_URL} (${plugin.ok ? "reachable" : "not reachable"})`);
  console.log(`[INFO] Log: ${paths.logFile}`);

  return pidRunning && mcp.ok && plugin.ok ? 0 : 1;
}

async function main(argv = process.argv.slice(2), rootDir = path.resolve(__dirname, "..")) {
  const command = parseCommand(argv);
  const paths = createPaths(rootDir);

  if (command === "foreground") {
    return runForeground(paths);
  }
  if (command === "start") {
    return startService(paths);
  }
  if (command === "stop") {
    return stopService(paths);
  }
  return statusService(paths);
}

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`[ERROR] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  createLaunchSpec,
  createPaths,
  createStopSpec,
  parseCommand,
  shouldResetNpmCacheAfterStartFailure,
};
