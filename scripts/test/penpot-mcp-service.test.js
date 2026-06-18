const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createPaths,
  createSpawnSpec,
  parseCommand,
} = require("../penpot-mcp-service");

test("createPaths keeps Penpot MCP runtime files under artifacts", () => {
  const rootDir = path.join("C:", "repo");

  const paths = createPaths(rootDir);

  assert.equal(paths.runtimeDir, path.join(rootDir, "artifacts", "penpot-mcp"));
  assert.equal(paths.stateFile, path.join(rootDir, "artifacts", "penpot-mcp", "server.json"));
  assert.equal(paths.logFile, path.join(rootDir, "artifacts", "penpot-mcp", "server.log"));
});

test("createSpawnSpec wraps npx through cmd.exe on Windows", () => {
  const spec = createSpawnSpec("win32", ["--version"]);

  assert.equal(spec.command, "cmd.exe");
  assert.deepEqual(spec.args, ["/d", "/s", "/c", "npx", "--version"]);
});

test("createSpawnSpec uses npx directly outside Windows", () => {
  const spec = createSpawnSpec("linux", ["--version"]);

  assert.equal(spec.command, "npx");
  assert.deepEqual(spec.args, ["--version"]);
});

test("parseCommand accepts supported service commands", () => {
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
