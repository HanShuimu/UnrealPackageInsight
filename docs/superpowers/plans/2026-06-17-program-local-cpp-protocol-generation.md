# Program-Local C++ Protocol Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Unreal backend Program self-contained by generating and tracking FlatBuffers C++ headers inside the Program source tree, then copying those headers into the Unreal Engine tree during the native backend build.

**Architecture:** The Node protocol package remains the owner of FlatBuffers schemas and generated JS/TS bindings. The Unreal Program becomes the owner of the generated C++ headers at `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol`, so `UnrealPackageInsightBackend.Build.cs` can resolve includes relative to `ModuleDirectory` without environment variables or repository searches. The root `scripts/build-native-backend.js` validates those Program-local generated headers before staging the Program into `<EngineRoot>/Engine/Source/Programs`.

**Tech Stack:** Node.js CommonJS scripts, `node:test`, FlatBuffers `flatc`, Unreal Build Tool C# `Build.cs`, Windows PowerShell commands for file movement.

---

## File Structure

- Modify `scripts/generate-protocol.js`: add a `getProtocolOutputPaths()` helper, send C++ generation to the Unreal Program path, keep TS/JS generation in the Node protocol package, and normalize both generated roots.
- Modify `scripts/build-native-backend.js`: add generated-header validation helpers, call validation before `copyDirectory()`, and export helpers for tests.
- Modify `node-shell/packages/protocol/test/generated-protocol.test.js`: assert generated C++ headers are committed in the Program path and the old Node `generated/cpp` copy is absent.
- Modify `node-shell/test/generate-protocol-script.test.js`: test the new output-path helper and prove `buildFlatcCommands()` uses the Program-local C++ output path.
- Modify `node-shell/test/build-native-backend-script.test.js`: test generated-header validation and update existing build orchestration fixtures to include Program-local generated headers.
- Create `node-shell/test/unreal-build-rules.test.js`: statically lock down that `Build.cs` no longer references `UPI_REPO_ROOT`, the old Node generated C++ include path, current-working-directory search, or parent-search helpers.
- Modify `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`: resolve generated C++ includes from `Path.Combine(ModuleDirectory, "Generated", "Protocol")` only.
- Move tracked generated C++ headers from `node-shell/packages/protocol/generated/cpp/*.h` to `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/*.h`.

This branch should remain uncommitted unless the user explicitly asks to commit. The commit commands below are handoff checkpoints for a future committed workflow; skip them in the current session.

### Task 1: Lock Generated Artifact Locations

**Files:**
- Modify: `node-shell/packages/protocol/test/generated-protocol.test.js`

- [ ] **Step 1: Write the failing generated artifact location test**

Replace the path setup and the first test in `node-shell/packages/protocol/test/generated-protocol.test.js` with this code:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const protocolRoot = path.join(repoRoot, 'node-shell', 'packages', 'protocol');
const generatedRoot = path.join(protocolRoot, 'generated');
const programCppGeneratedRoot = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'Generated',
  'Protocol',
);
const oldCppGeneratedRoot = path.join(generatedRoot, 'cpp');

test('commits generated FlatBuffers C++ headers in the Unreal Program and CommonJS modules', () => {
  const expectedCppFiles = [
    path.join(programCppGeneratedRoot, 'upi_backend_info_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_common_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_pak_analysis_generated.h'),
    path.join(programCppGeneratedRoot, 'upi_iostore_analysis_generated.h'),
  ];
  const expectedJsFiles = [
    path.join(generatedRoot, 'js', 'upi', 'v1.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'backend-info-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'pak-analysis-response.js'),
    path.join(generatedRoot, 'js', 'upi', 'v1', 'io-store-analysis-response.js'),
  ];

  assert.equal(fs.existsSync(oldCppGeneratedRoot), false, `remove duplicate generated C++ path: ${oldCppGeneratedRoot}`);

  for (const filePath of [...expectedCppFiles, ...expectedJsFiles]) {
    assert.equal(fs.existsSync(filePath), true, `missing generated file: ${filePath}`);
  }
});
```

Keep the existing `generated CommonJS barrel exports all root response modules` test below it unchanged.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test node-shell/packages/protocol/test/generated-protocol.test.js
```

Expected: FAIL because `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/*.h` does not exist yet and `node-shell/packages/protocol/generated/cpp` still exists.

- [ ] **Step 3: Defer commit**

Do not commit in this session. If the user later asks for commits, use:

```powershell
git add node-shell/packages/protocol/test/generated-protocol.test.js
git commit -m "test: lock program-local generated protocol headers"
```

### Task 2: Route Protocol Generation Outputs

**Files:**
- Modify: `node-shell/test/generate-protocol-script.test.js`
- Modify: `scripts/generate-protocol.js`

- [ ] **Step 1: Write failing tests for protocol output paths**

In `node-shell/test/generate-protocol-script.test.js`, add `getProtocolOutputPaths` to the import:

```js
const {
  buildFlatcCommands,
  getProtocolOutputPaths,
  getTypescriptCompiler,
  normalizeLineEndings,
  parseArgs,
  setGeneratedTypescriptBarrel,
} = require('../../scripts/generate-protocol.js');
```

Add this test after the `parseArgs` tests:

```js
test('getProtocolOutputPaths routes C++ to the Unreal Program and JS/TS to the Node protocol package', () => {
  const repoRoot = path.join(path.sep, 'repo', 'UnrealPackageInsight');

  assert.deepEqual(getProtocolOutputPaths(repoRoot), {
    repoRoot,
    nodeShellDir: path.join(repoRoot, 'node-shell'),
    protocolDir: path.join(repoRoot, 'node-shell', 'packages', 'protocol'),
    cppOut: path.join(
      repoRoot,
      'ue-backend',
      'UnrealPackageInsightBackend',
      'Source',
      'UnrealPackageInsightBackend',
      'Generated',
      'Protocol',
    ),
    tsOut: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated', 'ts'),
    jsOut: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated', 'js'),
    nodeGeneratedDir: path.join(repoRoot, 'node-shell', 'packages', 'protocol', 'generated'),
  });
});
```

Add this assertion to the existing `buildFlatcCommands builds cpp and ts commands with common schema first` test after the current `assert.deepEqual(commands, [...])` block:

```js
const repoRoot = path.join(path.sep, 'repo', 'UnrealPackageInsight');
const outputs = getProtocolOutputPaths(repoRoot);
const routedCommands = buildFlatcCommands({
  flatc: 'flatc-bin',
  protocolDir: outputs.protocolDir,
  cppOut: outputs.cppOut,
  tsOut: outputs.tsOut,
});
assert.equal(
  routedCommands[0].args[routedCommands[0].args.indexOf('-o') + 1],
  outputs.cppOut,
);
assert.equal(
  routedCommands[1].args[routedCommands[1].args.indexOf('-o') + 1],
  outputs.tsOut,
);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
node --test node-shell/test/generate-protocol-script.test.js
```

Expected: FAIL with `getProtocolOutputPaths` missing from `scripts/generate-protocol.js`.

- [ ] **Step 3: Implement `getProtocolOutputPaths()`**

In `scripts/generate-protocol.js`, add this function after `repoRootFromScript()`:

```js
function getProtocolOutputPaths(repoRoot = repoRootFromScript()) {
  const nodeShellDir = path.join(repoRoot, 'node-shell');
  const protocolDir = path.join(nodeShellDir, 'packages', 'protocol');
  const nodeGeneratedDir = path.join(protocolDir, 'generated');
  return {
    repoRoot,
    nodeShellDir,
    protocolDir,
    cppOut: path.join(
      repoRoot,
      'ue-backend',
      'UnrealPackageInsightBackend',
      'Source',
      'UnrealPackageInsightBackend',
      'Generated',
      'Protocol',
    ),
    tsOut: path.join(nodeGeneratedDir, 'ts'),
    jsOut: path.join(nodeGeneratedDir, 'js'),
    nodeGeneratedDir,
  };
}
```

- [ ] **Step 4: Use the new paths in `main()`**

Replace the path setup at the start of `main()` in `scripts/generate-protocol.js` with:

```js
const args = parseArgs(argv);
const paths = getProtocolOutputPaths();
const flatc = args.flatc || process.env.UPI_FLATC || 'flatc';
```

Replace all uses in `main()` as follows:

```js
const tsc = getTypescriptCompiler(paths.nodeShellDir);

for (const outDir of [paths.cppOut, paths.tsOut, paths.jsOut]) {
  ensureEmptyDirectory(outDir);
}

for (const command of buildFlatcCommands({
  flatc,
  protocolDir: paths.protocolDir,
  cppOut: paths.cppOut,
  tsOut: paths.tsOut,
})) {
  try {
    execFileSync(command.executable, command.args, { stdio: 'inherit' });
  } catch (error) {
    throw new Error(`flatc ${command.label} generation failed.`);
  }
}

setGeneratedTypescriptBarrel(path.join(paths.tsOut, 'upi', 'v1.ts'));

const tsFiles = collectFiles(paths.tsOut, (filePath) => filePath.endsWith('.ts'));
if (tsFiles.length === 0) {
  throw new Error(`flatc TypeScript generation produced no .ts files in ${paths.tsOut}.`);
}
```

Replace the TypeScript compiler args `--rootDir` and `--outDir` values with `paths.tsOut` and `paths.jsOut`.

Replace the final normalization and log with:

```js
normalizeLineEndings(paths.cppOut);
normalizeLineEndings(paths.nodeGeneratedDir);

console.log(`[OK] Generated FlatBuffers bindings in ${paths.nodeGeneratedDir} and ${paths.cppOut}`);
```

- [ ] **Step 5: Export `getProtocolOutputPaths()`**

Add it to `module.exports`:

```js
module.exports = {
  REQUIRED_FLATC_VERSION,
  buildFlatcCommands,
  getProtocolOutputPaths,
  getTypescriptCompiler,
  main,
  normalizeLineEndings,
  parseArgs,
  setGeneratedTypescriptBarrel,
};
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```powershell
node --test node-shell/test/generate-protocol-script.test.js
```

Expected: PASS.

- [ ] **Step 7: Defer commit**

Do not commit in this session. If the user later asks for commits, use:

```powershell
git add scripts/generate-protocol.js node-shell/test/generate-protocol-script.test.js
git commit -m "feat: route generated cpp protocol to program source"
```

### Task 3: Move Tracked Generated C++ Headers

**Files:**
- Delete: `node-shell/packages/protocol/generated/cpp/upi_backend_info_generated.h`
- Delete: `node-shell/packages/protocol/generated/cpp/upi_common_generated.h`
- Delete: `node-shell/packages/protocol/generated/cpp/upi_iostore_analysis_generated.h`
- Delete: `node-shell/packages/protocol/generated/cpp/upi_pak_analysis_generated.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/upi_backend_info_generated.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/upi_common_generated.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/upi_iostore_analysis_generated.h`
- Create: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated/Protocol/upi_pak_analysis_generated.h`

- [ ] **Step 1: Move the headers to the Program-local generated directory**

Run these mechanical file moves from the repository root:

```powershell
New-Item -ItemType Directory -Force -Path 'ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol'
Move-Item -LiteralPath 'node-shell\packages\protocol\generated\cpp\upi_backend_info_generated.h' -Destination 'ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol\upi_backend_info_generated.h'
Move-Item -LiteralPath 'node-shell\packages\protocol\generated\cpp\upi_common_generated.h' -Destination 'ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol\upi_common_generated.h'
Move-Item -LiteralPath 'node-shell\packages\protocol\generated\cpp\upi_iostore_analysis_generated.h' -Destination 'ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol\upi_iostore_analysis_generated.h'
Move-Item -LiteralPath 'node-shell\packages\protocol\generated\cpp\upi_pak_analysis_generated.h' -Destination 'ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol\upi_pak_analysis_generated.h'
Remove-Item -LiteralPath 'node-shell\packages\protocol\generated\cpp' -Force
```

- [ ] **Step 2: Run the generated artifact test and verify it passes**

Run:

```powershell
node --test node-shell/packages/protocol/test/generated-protocol.test.js
```

Expected: PASS.

- [ ] **Step 3: Defer commit**

Do not commit in this session. If the user later asks for commits, use:

```powershell
git add -A node-shell/packages/protocol/generated/cpp ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/Generated node-shell/packages/protocol/test/generated-protocol.test.js
git commit -m "chore: move generated cpp protocol into unreal program"
```

### Task 4: Make Build.cs Program-Local Only

**Files:**
- Create: `node-shell/test/unreal-build-rules.test.js`
- Modify: `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`

- [ ] **Step 1: Add a failing static test for Build.cs**

Create `node-shell/test/unreal-build-rules.test.js` with:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const buildRulesPath = path.join(
  repoRoot,
  'ue-backend',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'UnrealPackageInsightBackend.Build.cs',
);

test('Unreal Build.cs uses Program-local generated protocol includes only', () => {
  const source = fs.readFileSync(buildRulesPath, 'utf8');

  assert.equal(source.includes('UPI_REPO_ROOT'), false);
  assert.equal(source.includes('Path.Combine("node-shell", "packages", "protocol", "generated", "cpp")'), false);
  assert.equal(source.includes('FindGeneratedCppIncludePath'), false);
  assert.equal(source.includes('Directory.GetCurrentDirectory()'), false);
  assert.match(source, /Path\.Combine\(ModuleDirectory,\s*"Generated",\s*"Protocol"\)/);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
node --test node-shell/test/unreal-build-rules.test.js
```

Expected: FAIL because `Build.cs` still contains `UPI_REPO_ROOT`, the old Node generated C++ path, `Directory.GetCurrentDirectory()`, and `FindGeneratedCppIncludePath`.

- [ ] **Step 3: Replace `ResolveGeneratedCppIncludePath()` in Build.cs**

In `ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs`, replace both `ResolveGeneratedCppIncludePath()` and `FindGeneratedCppIncludePath()` with:

```csharp
private static string ResolveGeneratedCppIncludePath(string ModuleDirectory)
{
	string GeneratedProtocolPath = Path.GetFullPath(Path.Combine(ModuleDirectory, "Generated", "Protocol"));
	if (Directory.Exists(GeneratedProtocolPath))
	{
		return GeneratedProtocolPath;
	}

	throw new BuildException($"Generated protocol C++ includes are missing at {GeneratedProtocolPath}. Run npm.cmd --prefix node-shell run generate-protocol from the UnrealPackageInsight repo root before building the native backend.");
}
```

Keep the existing constructor and `PrivateIncludePaths.AddRange()` call, so the first include path remains `ResolveGeneratedCppIncludePath(ModuleDirectory)`.

- [ ] **Step 4: Run the Build.cs static test and verify it passes**

Run:

```powershell
node --test node-shell/test/unreal-build-rules.test.js
```

Expected: PASS.

- [ ] **Step 5: Defer commit**

Do not commit in this session. If the user later asks for commits, use:

```powershell
git add node-shell/test/unreal-build-rules.test.js ue-backend/UnrealPackageInsightBackend/Source/UnrealPackageInsightBackend/UnrealPackageInsightBackend.Build.cs
git commit -m "fix: resolve generated protocol includes from program source"
```

### Task 5: Validate Generated Headers Before Native Staging

**Files:**
- Modify: `node-shell/test/build-native-backend-script.test.js`
- Modify: `scripts/build-native-backend.js`

- [ ] **Step 1: Add validation exports to the test import**

In `node-shell/test/build-native-backend-script.test.js`, update the destructuring import to include the new helpers:

```js
const {
  ALL_CONFIGURATIONS,
  BACKEND_DLL_NAME,
  REQUIRED_GENERATED_PROTOCOL_HEADERS,
  assertProgramGeneratedProtocolHeaders,
  buildNativeBackends,
  createBackendManifest,
  defaultRunBuild,
  defaultSmokeCheck,
  ensureDirectory,
  findBuiltDll,
  getNativeBackendDir,
  getProgramGeneratedProtocolDir,
  parseArgs,
  readEngineVersion,
  removeDirectory,
  repoRootFromScript,
  resolveConfigurations,
  runBatchFile,
} = require('../../scripts/build-native-backend.js');
```

- [ ] **Step 2: Add a test helper for fake Program sources**

Add this helper after `test` imports:

```js
function writeRequiredGeneratedProtocolHeaders(sourceDir) {
  const generatedProtocolDir = path.join(
    sourceDir,
    'Source',
    'UnrealPackageInsightBackend',
    'Generated',
    'Protocol',
  );
  fs.mkdirSync(generatedProtocolDir, { recursive: true });
  for (const fileName of REQUIRED_GENERATED_PROTOCOL_HEADERS) {
    fs.writeFileSync(path.join(generatedProtocolDir, fileName), fileName);
  }
  return generatedProtocolDir;
}
```

- [ ] **Step 3: Write failing validation tests**

Add these tests after `exports orchestration helper functions used by the build script`:

```js
test('getProgramGeneratedProtocolDir points at Program-local generated headers', () => {
  assert.equal(
    getProgramGeneratedProtocolDir('C:\\repo\\UnrealPackageInsight'),
    'C:\\repo\\UnrealPackageInsight\\ue-backend\\UnrealPackageInsightBackend\\Source\\UnrealPackageInsightBackend\\Generated\\Protocol',
  );
});

test('assertProgramGeneratedProtocolHeaders requires every generated C++ protocol header', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-generated-protocol-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const generatedProtocolDir = path.join(root, 'Generated', 'Protocol');
  fs.mkdirSync(generatedProtocolDir, { recursive: true });

  for (const fileName of REQUIRED_GENERATED_PROTOCOL_HEADERS.filter((name) => name !== 'upi_iostore_analysis_generated.h')) {
    fs.writeFileSync(path.join(generatedProtocolDir, fileName), fileName);
  }

  assert.throws(
    () => assertProgramGeneratedProtocolHeaders(generatedProtocolDir),
    /Generated protocol C\+\+ header missing: .*upi_iostore_analysis_generated\.h/,
  );
});
```

Add this test near the other staged-source guard tests:

```js
test('buildNativeBackends preserves existing staged source when generated protocol headers are missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-build-generated-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const engineRoot = path.join(root, 'engine');
  const sourceDir = path.join(repoRoot, 'ue-backend', 'UnrealPackageInsightBackend');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'UnrealPackageInsightBackend.Target.cs'), 'target');
  const destinationDir = path.join(engineRoot, 'Engine', 'Source', 'Programs', 'UnrealPackageInsightBackend');
  const markerPath = path.join(destinationDir, 'keep.marker');
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.writeFileSync(markerPath, 'existing');
  const versionPath = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({ MajorVersion: 5, MinorVersion: 7, PatchVersion: 4 }));
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  fs.mkdirSync(path.dirname(buildBat), { recursive: true });
  fs.writeFileSync(buildBat, '');

  assert.throws(
    () => buildNativeBackends({ repoRoot, engineRoot }),
    /Generated protocol C\+\+ directory missing:/,
  );
  assert.equal(fs.existsSync(markerPath), true);
});
```

- [ ] **Step 4: Update existing successful build fixtures**

In each existing `buildNativeBackends(...)` test that creates a fake `sourceDir` and expects the build to proceed past validation, add this line after writing `UnrealPackageInsightBackend.Target.cs`:

```js
writeRequiredGeneratedProtocolHeaders(sourceDir);
```

The tests that should receive this line are:

- `buildNativeBackends preserves existing staged source when configuration is invalid`
- `buildNativeBackends preserves existing staged source when Build.bat is not a file`
- `buildNativeBackends stages and builds all configurations by default`

In `buildNativeBackends stages and builds all configurations by default`, also add this assertion after the existing staged Target.cs assertion:

```js
assert.equal(fs.existsSync(path.join(
  engineRoot,
  'Engine',
  'Source',
  'Programs',
  'UnrealPackageInsightBackend',
  'Source',
  'UnrealPackageInsightBackend',
  'Generated',
  'Protocol',
  'upi_common_generated.h',
)), true);
```

- [ ] **Step 5: Run the focused test and verify it fails**

Run:

```powershell
node --test node-shell/test/build-native-backend-script.test.js
```

Expected: FAIL because `REQUIRED_GENERATED_PROTOCOL_HEADERS`, `getProgramGeneratedProtocolDir()`, and `assertProgramGeneratedProtocolHeaders()` are not exported yet.

- [ ] **Step 6: Implement generated protocol validation helpers**

In `scripts/build-native-backend.js`, add this constant near `PROTOCOL_VERSION`:

```js
const REQUIRED_GENERATED_PROTOCOL_HEADERS = [
  'upi_backend_info_generated.h',
  'upi_common_generated.h',
  'upi_iostore_analysis_generated.h',
  'upi_pak_analysis_generated.h',
];
```

Add these functions after `getNativeBackendDir()`:

```js
function getProgramGeneratedProtocolDir(repoRoot) {
  return path.join(
    repoRoot,
    'ue-backend',
    'UnrealPackageInsightBackend',
    'Source',
    'UnrealPackageInsightBackend',
    'Generated',
    'Protocol',
  );
}

function assertProgramGeneratedProtocolHeaders(generatedProtocolDir) {
  if (!fs.existsSync(generatedProtocolDir) || !fs.statSync(generatedProtocolDir).isDirectory()) {
    throw new Error(`Generated protocol C++ directory missing: ${generatedProtocolDir}. Run npm.cmd --prefix node-shell run generate-protocol before building native backend.`);
  }

  for (const fileName of REQUIRED_GENERATED_PROTOCOL_HEADERS) {
    const filePath = path.join(generatedProtocolDir, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Generated protocol C++ header missing: ${filePath}. Run npm.cmd --prefix node-shell run generate-protocol before building native backend.`);
    }
  }
}
```

- [ ] **Step 7: Call validation before copying the Program**

In `buildNativeBackends()` after the `sourceDir` existence check and before `copyDirectory(sourceDir, destinationDir)`, add:

```js
const generatedProtocolDir = getProgramGeneratedProtocolDir(repoRoot);
assertProgramGeneratedProtocolHeaders(generatedProtocolDir);
```

Keep `readEngineVersion(engineRoot)`, `Build.bat` validation, and `resolveConfigurations()` before `copyDirectory()` so every input guard preserves the existing staged source.

- [ ] **Step 8: Export validation helpers**

Add these names to `module.exports`:

```js
REQUIRED_GENERATED_PROTOCOL_HEADERS,
assertProgramGeneratedProtocolHeaders,
getProgramGeneratedProtocolDir,
```

- [ ] **Step 9: Run the focused test and verify it passes**

Run:

```powershell
node --test node-shell/test/build-native-backend-script.test.js
```

Expected: PASS.

- [ ] **Step 10: Defer commit**

Do not commit in this session. If the user later asks for commits, use:

```powershell
git add scripts/build-native-backend.js node-shell/test/build-native-backend-script.test.js
git commit -m "fix: validate program generated protocol before native build"
```

### Task 6: Verify End-to-End Contract

**Files:**
- Verify: all files modified in Tasks 1-5

- [ ] **Step 1: Run focused tests together**

Run:

```powershell
node --test node-shell/packages/protocol/test/generated-protocol.test.js node-shell/test/generate-protocol-script.test.js node-shell/test/build-native-backend-script.test.js node-shell/test/unreal-build-rules.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the full Node test suite**

Run:

```powershell
npm.cmd test
```

Expected: PASS with all existing tests plus the new `unreal-build-rules.test.js`.

- [ ] **Step 3: Search for removed build-time dependencies**

Run:

```powershell
rg -n "UPI_REPO_ROOT|node-shell[\\/]+packages[\\/]+protocol[\\/]+generated[\\/]+cpp" ue-backend scripts node-shell/test node-shell/packages/protocol/test
```

Expected: no output.

- [ ] **Step 4: Inspect generated C++ tracking paths**

Run:

```powershell
rg --files ue-backend\UnrealPackageInsightBackend\Source\UnrealPackageInsightBackend\Generated\Protocol
rg --files node-shell\packages\protocol\generated\cpp
```

Expected: the first command lists four `*_generated.h` files. The second command exits with no files because the old Node C++ generated directory is gone.

- [ ] **Step 5: Optional approved native build smoke**

Only run this if the user approves writing to the Unreal Engine tree:

```powershell
npm.cmd run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

Expected: the script builds `Debug`, `Development`, and `Shipping`; prints three backend ids; stages DLLs and `backend.json` under `node-shell/native/win32-x64/ue-<major.minor.patch>/<configurationKey>`.

- [ ] **Step 6: Defer final commit**

Do not commit in this session. If the user later asks for a single final commit, use:

```powershell
git add -A scripts node-shell ue-backend docs/superpowers/specs docs/superpowers/plans
git commit -m "fix: make unreal backend protocol generation program local"
```
