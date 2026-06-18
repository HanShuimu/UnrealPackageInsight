const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createLaunchSpec,
  createPaths,
  createStopSpec,
  parseCommand,
  shouldResetNpmCacheAfterStartFailure,
} = require("../penpot-mcp-service");

test("createPaths keeps Penpot MCP runtime files under artifacts", () => {
  const rootDir = path.join("C:", "repo");

  const paths = createPaths(rootDir);

  assert.equal(paths.runtimeDir, path.join(rootDir, "artifacts", "penpot-mcp"));
  assert.equal(paths.npmCacheDir, path.join(rootDir, "artifacts", "penpot-mcp", "npm-cache"));
  assert.equal(paths.stateFile, path.join(rootDir, "artifacts", "penpot-mcp", "server.json"));
  assert.equal(paths.logFile, path.join(rootDir, "artifacts", "penpot-mcp", "server.log"));
});

test("createLaunchSpec uses hidden PowerShell Start-Process on Windows", () => {
  const rootDir = path.join("C:", "repo");
  const paths = createPaths(rootDir);
  const spec = createLaunchSpec("win32", ["--version"], paths, rootDir);

  assert.equal(spec.command, "powershell.exe");
  assert.match(spec.args.join(" "), /Start-Process/);
  assert.match(spec.args.join(" "), /WindowStyle Hidden/);
  assert.match(spec.args.join(" "), /npm_config_cache/);
  assert.match(spec.args.join(" "), /registry\.npmjs\.org/);
  assert.match(spec.args.join(" "), /PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS/);
  assert.match(spec.args.join(" "), /npx --registry https:\/\/registry\.npmjs\.org\/ --version/);
});

test("createLaunchSpec uses npx directly outside Windows", () => {
  const rootDir = path.join("C:", "repo");
  const paths = createPaths(rootDir);
  const spec = createLaunchSpec("linux", ["--version"], paths, rootDir);

  assert.equal(spec.command, "npx");
  assert.deepEqual(spec.args, ["--registry", "https://registry.npmjs.org/", "--version"]);
  assert.equal(spec.env.npm_config_cache, paths.npmCacheDir);
  assert.equal(spec.env.PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS, "true");
});

test("createStopSpec kills the Windows process tree", () => {
  const spec = createStopSpec("win32", 1234);

  assert.equal(spec.command, "taskkill");
  assert.deepEqual(spec.args, ["/PID", "1234", "/T", "/F"]);
});

test("shouldResetNpmCacheAfterStartFailure retries once after an exited process", () => {
  assert.equal(shouldResetNpmCacheAfterStartFailure({ pidRunning: false }, 0), true);
  assert.equal(shouldResetNpmCacheAfterStartFailure({ pidRunning: false }, 1), false);
  assert.equal(shouldResetNpmCacheAfterStartFailure({ pidRunning: true }, 0), false);
});

test("parseCommand accepts supported service commands", () => {
  assert.equal(parseCommand(["foreground"]), "foreground");
  assert.equal(parseCommand(["start"]), "start");
  assert.equal(parseCommand(["status"]), "status");
  assert.equal(parseCommand(["stop"]), "stop");
});

test("parseCommand rejects unknown service commands", () => {
  assert.throws(
    () => parseCommand(["restart"]),
    /Unsupported Penpot MCP service command/
  );
});

test("batch wrappers pause so double-clicked windows stay readable", () => {
  for (const fileName of [
    "start-penpot-mcp.bat",
    "status-penpot-mcp.bat",
    "stop-penpot-mcp.bat",
  ]) {
    const filePath = path.resolve(__dirname, "..", "..", fileName);
    const content = fs.readFileSync(filePath, "utf8");
    assert.match(content, /\bcall npm run\b/i, fileName);
    assert.match(content, /\bpause\b/i, fileName);
  }
});
