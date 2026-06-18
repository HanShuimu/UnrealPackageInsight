const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SUPPORTED_COMMANDS = new Set(["start", "status", "stop"]);
const PENPOT_ARGS = ["-y", "@penpot/mcp@latest"];
const MCP_URL = "http://localhost:4401/mcp";
const PLUGIN_URL = "http://localhost:4400/manifest.json";

function createPaths(rootDir) {
  const runtimeDir = path.join(rootDir, "artifacts", "penpot-mcp");
  return {
    runtimeDir,
    stateFile: path.join(runtimeDir, "server.json"),
    logFile: path.join(runtimeDir, "server.log"),
  };
}

function createSpawnSpec(platform = process.platform, args = PENPOT_ARGS) {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", ...args],
    };
  }

  return {
    command: "npx",
    args,
  };
}

function parseCommand(argv) {
  const command = argv[0] || "status";
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(
      `Unsupported Penpot MCP service command: ${command}. Use start, status, or stop.`
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

async function startService(paths) {
  ensureRuntimeDir(paths);

  const existing = readState(paths);
  if (existing && isPidRunning(existing.pid)) {
    console.log(`[INFO] Penpot MCP server is already running. PID: ${existing.pid}`);
    console.log(`[INFO] Log: ${paths.logFile}`);
    return 0;
  }

  const out = fs.openSync(paths.logFile, "a");
  const err = fs.openSync(paths.logFile, "a");
  const spec = createSpawnSpec();
  const child = spawn(spec.command, spec.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(out);
  fs.closeSync(err);

  writeState(paths, {
    pid: child.pid,
    command: spec.command,
    args: spec.args,
    mcpUrl: MCP_URL,
    pluginUrl: PLUGIN_URL,
    logFile: paths.logFile,
    startedAt: new Date().toISOString(),
  });

  console.log(`[OK] Started Penpot MCP server in the background. PID: ${child.pid}`);
  console.log(`[INFO] MCP endpoint: ${MCP_URL}`);
  console.log(`[INFO] Plugin manifest: ${PLUGIN_URL}`);
  console.log(`[INFO] Log: ${paths.logFile}`);
  return 0;
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

  await new Promise((resolve) => {
    if (process.platform === "win32") {
      const taskkill = spawn("taskkill", ["/PID", String(state.pid), "/T", "/F"], {
        stdio: "inherit",
        windowsHide: true,
      });
      taskkill.on("exit", () => resolve());
      taskkill.on("error", () => resolve());
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
    resolve();
  });

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
  createPaths,
  createSpawnSpec,
  parseCommand,
};
