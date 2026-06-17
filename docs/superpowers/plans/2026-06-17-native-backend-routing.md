# Native Backend Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GUI and CLI choose staged Unreal backend DLLs from container probes and generated manifests, with JS-only build scripts and documented C++ backend rebuild workflow.

**Architecture:** Keep container format knowledge in `analysis-domain` and native backend mechanics in `backend-core`. GUI and CLI compose the analysis-domain probe with backend-core manifest registry, selector, and client provider at analysis time; build-time staging is handled by root npm scripts that call `scripts/build-native-backend.js`.

**Tech Stack:** Node.js CommonJS, Node built-in `node:test`, Electron IPC, Koffi, FlatBuffers code generation, Unreal Build Tool invoked from Node via `child_process`.

---

## Scope Check

The approved spec covers runtime routing, JavaScript build tooling, GUI/CLI integration, and agent workflow documentation. These are implemented in one plan because each task contributes to one deployable behavior: running the app without runtime DLL or EngineRoot inputs while selecting staged native backends from container metadata.

## File Structure

- Create `package.json`: root developer command hub for `npm run build`, `build:native:*`, and root test delegation.
- Create `scripts/build-native-backend.js`: stage UE Program source, invoke Unreal Build Tool, copy DLLs into version/config native directories, write manifests, and smoke-check the staged DLL.
- Create `scripts/generate-protocol.js`: JavaScript replacement for `scripts/generate-protocol.ps1`.
- Delete `scripts/stage-ue-backend.ps1`, `scripts/build-ue-backend.ps1`, `scripts/generate-protocol.ps1`.
- Modify `node-shell/package.json`: route `generate-protocol` through the JS script and keep app/test commands.
- Create `node-shell/packages/backend-core/src/backend-registry.js`: scan and validate native backend manifests.
- Create `node-shell/packages/analysis-domain/src/container-probe.js`: probe Pak footer and UTOC header metadata.
- Create `node-shell/packages/backend-core/src/backend-selector.js`: choose compatible manifests from probe metadata.
- Create `node-shell/packages/backend-core/src/backend-client-provider.js`: lazily create and cache backend clients by backend id.
- Modify `node-shell/packages/analysis-domain/src/analysis-service.js`: request backend clients at analysis time and include backend id in result cache keys.
- Modify `node-shell/apps/desktop/main.js`: stop startup DLL loading, expose backend registry summary, support backend chooser round trip.
- Modify `node-shell/apps/desktop/preload.js`: expose `chooseBackend`.
- Modify `node-shell/apps/desktop/renderer/index.html`, `renderer.js`, `styles.css`: add backend chooser dialog.
- Modify `node-shell/bin/upi-gui.js`: launch Electron without backend preflight or runtime backend env injection.
- Modify `node-shell/src/index.js`: implement shared-routing CLI commands.
- Modify `node-shell/bin/upi-cli.js`: delegate to `src/index.js`.
- Add `.agents/workflow/update-native-backend.md` and `AGENTS.md`: document mandatory native backend rebuild workflow after C++ changes.

## Task 1: Root npm Commands and Script Test Harness

**Files:**
- Create: `package.json`
- Test: `node-shell/test/root-package-scripts.test.js`

- [ ] **Step 1: Write the failing root package script test**

Create `node-shell/test/root-package-scripts.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('root package exposes native build command matrix', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.type, 'commonjs');
  assert.equal(rootPackage.scripts.build, 'node scripts/build-native-backend.js');
  assert.equal(rootPackage.scripts['build:native'], 'node scripts/build-native-backend.js');
  assert.equal(rootPackage.scripts['build:native:debug'], 'node scripts/build-native-backend.js --configuration Debug');
  assert.equal(rootPackage.scripts['build:native:development'], 'node scripts/build-native-backend.js --configuration Development');
  assert.equal(rootPackage.scripts['build:native:shipping'], 'node scripts/build-native-backend.js --configuration Shipping');
  assert.equal(rootPackage.scripts.test, 'npm --prefix node-shell test');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/root-package-scripts.test.js
```

Expected: FAIL with `ENOENT` for `package.json`.

- [ ] **Step 3: Add the root package**

Create `package.json`:

```json
{
  "name": "unreal-package-insight",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build": "node scripts/build-native-backend.js",
    "build:native": "node scripts/build-native-backend.js",
    "build:native:debug": "node scripts/build-native-backend.js --configuration Debug",
    "build:native:development": "node scripts/build-native-backend.js --configuration Development",
    "build:native:shipping": "node scripts/build-native-backend.js --configuration Shipping",
    "test": "npm --prefix node-shell test"
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/root-package-scripts.test.js
```

Expected: PASS for `root package exposes native build command matrix`.

- [ ] **Step 5: Commit**

```powershell
git add package.json node-shell/test/root-package-scripts.test.js
git commit -m "Add root native build npm commands"
```

## Task 2: Build Script Pure Functions

**Files:**
- Create: `scripts/build-native-backend.js`
- Test: `node-shell/test/build-native-backend-script.test.js`

- [ ] **Step 1: Write failing tests for version, configurations, output path, and manifest**

Create `node-shell/test/build-native-backend-script.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALL_CONFIGURATIONS,
  createBackendManifest,
  getNativeBackendDir,
  parseArgs,
  readEngineVersion,
  resolveConfigurations,
} = require('../../scripts/build-native-backend.js');

test('parseArgs accepts engine root and optional configuration', () => {
  assert.deepEqual(parseArgs(['--engine-root', 'C:\\UE', '--configuration', 'Shipping']), {
    engineRoot: 'C:\\UE',
    configuration: 'Shipping',
  });
});

test('resolveConfigurations builds the full matrix when configuration is omitted', () => {
  assert.deepEqual(resolveConfigurations({}), ALL_CONFIGURATIONS);
  assert.deepEqual(resolveConfigurations({ configuration: 'development' }), ['Development']);
});

test('readEngineVersion returns major.minor.patch from Build.version', (t) => {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-engine-root-'));
  t.after(() => fs.rmSync(engineRoot, { recursive: true, force: true }));
  const versionPath = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({
    MajorVersion: 5,
    MinorVersion: 7,
    PatchVersion: 4
  }));

  assert.equal(readEngineVersion(engineRoot), '5.7.4');
});

test('getNativeBackendDir includes platform, arch, engine version, and configuration key', () => {
  assert.equal(
    getNativeBackendDir({
      repoRoot: 'C:\\repo\\UnrealPackageInsight',
      hostPlatform: 'win32',
      hostArch: 'x64',
      engineVersion: '5.7.4',
      configuration: 'Development',
    }),
    'C:\\repo\\UnrealPackageInsight\\node-shell\\native\\win32-x64\\ue-5.7.4\\development',
  );
});

test('createBackendManifest records configuration-specific backend id', () => {
  assert.deepEqual(createBackendManifest({
    engineVersion: '5.7.4',
    hostPlatform: 'win32',
    hostArch: 'x64',
    unrealPlatform: 'Win64',
    configuration: 'Development',
  }), {
    id: 'ue-5.7.4-win32-x64-development',
    engineVersion: '5.7.4',
    hostPlatform: 'win32',
    hostArch: 'x64',
    unrealPlatform: 'Win64',
    configuration: 'Development',
    configurationKey: 'development',
    protocolVersion: 1,
    dll: 'UnrealPackageInsightBackend.dll',
    supports: {
      pak: { versionMin: 1, versionMax: 12 },
      iostore: { tocVersionMin: 1, tocVersionMax: 8 },
    },
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/build-native-backend-script.test.js
```

Expected: FAIL with `Cannot find module '../../scripts/build-native-backend.js'`.

- [ ] **Step 3: Add pure helpers to `scripts/build-native-backend.js`**

Create the file with these exports first; do not invoke UBT in this task:

```js
#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ALL_CONFIGURATIONS = ['Debug', 'Development', 'Shipping'];
const DEFAULT_UNREAL_PLATFORM = 'Win64';
const BACKEND_DLL_NAME = 'UnrealPackageInsightBackend.dll';
const PROTOCOL_VERSION = 1;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--engine-root') {
      parsed.engineRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--configuration') {
      parsed.configuration = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

function normalizeConfiguration(configuration) {
  const found = ALL_CONFIGURATIONS.find((candidate) => (
    candidate.toLowerCase() === String(configuration || '').toLowerCase()
  ));
  if (!found) {
    throw new Error(`Unsupported configuration: ${configuration}`);
  }
  return found;
}

function configurationKey(configuration) {
  return normalizeConfiguration(configuration).toLowerCase();
}

function resolveConfigurations(args) {
  return args.configuration
    ? [normalizeConfiguration(args.configuration)]
    : [...ALL_CONFIGURATIONS];
}

function readEngineVersion(engineRoot) {
  const versionPath = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
  const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  for (const key of ['MajorVersion', 'MinorVersion', 'PatchVersion']) {
    if (!Number.isInteger(version[key])) {
      throw new Error(`Build.version field ${key} must be an integer`);
    }
  }
  return `${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion}`;
}

function getNativeBackendDir({
  repoRoot,
  hostPlatform,
  hostArch,
  engineVersion,
  configuration,
}) {
  return path.join(
    repoRoot,
    'node-shell',
    'native',
    `${hostPlatform}-${hostArch}`,
    `ue-${engineVersion}`,
    configurationKey(configuration),
  );
}

function createBackendManifest({
  engineVersion,
  hostPlatform,
  hostArch,
  unrealPlatform = DEFAULT_UNREAL_PLATFORM,
  configuration,
}) {
  const normalizedConfiguration = normalizeConfiguration(configuration);
  return {
    id: `ue-${engineVersion}-${hostPlatform}-${hostArch}-${configurationKey(normalizedConfiguration)}`,
    engineVersion,
    hostPlatform,
    hostArch,
    unrealPlatform,
    configuration: normalizedConfiguration,
    configurationKey: configurationKey(normalizedConfiguration),
    protocolVersion: PROTOCOL_VERSION,
    dll: BACKEND_DLL_NAME,
    supports: {
      pak: { versionMin: 1, versionMax: 12 },
      iostore: { tocVersionMin: 1, tocVersionMax: 8 },
    },
  };
}

module.exports = {
  ALL_CONFIGURATIONS,
  BACKEND_DLL_NAME,
  DEFAULT_UNREAL_PLATFORM,
  PROTOCOL_VERSION,
  configurationKey,
  createBackendManifest,
  getNativeBackendDir,
  normalizeConfiguration,
  parseArgs,
  readEngineVersion,
  resolveConfigurations,
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/build-native-backend-script.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/build-native-backend.js node-shell/test/build-native-backend-script.test.js
git commit -m "Add native backend build manifest helpers"
```

## Task 3: Build Script Stage, Build, Copy, Manifest, and Smoke Flow

**Files:**
- Modify: `scripts/build-native-backend.js`
- Test: `node-shell/test/build-native-backend-script.test.js`

- [ ] **Step 1: Add failing tests for orchestration without running UBT**

Append to `node-shell/test/build-native-backend-script.test.js`:

```js
const {
  buildNativeBackends,
  findBuiltDll,
} = require('../../scripts/build-native-backend.js');

test('findBuiltDll discovers the newest backend DLL under Engine/Binaries/Win64', (t) => {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-built-dll-'));
  t.after(() => fs.rmSync(engineRoot, { recursive: true, force: true }));
  const dllPath = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealPackageInsightBackend', 'UnrealPackageInsightBackend.dll');
  fs.mkdirSync(path.dirname(dllPath), { recursive: true });
  fs.writeFileSync(dllPath, '');

  assert.equal(findBuiltDll(engineRoot), dllPath);
});

test('buildNativeBackends stages and builds all configurations by default', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-build-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const engineRoot = path.join(root, 'engine');
  const sourceDir = path.join(repoRoot, 'ue-backend', 'UnrealPackageInsightBackend');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'UnrealPackageInsightBackend.Target.cs'), 'target');
  const versionPath = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
  fs.mkdirSync(path.dirname(versionPath), { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify({ MajorVersion: 5, MinorVersion: 7, PatchVersion: 4 }));
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  fs.mkdirSync(path.dirname(buildBat), { recursive: true });
  fs.writeFileSync(buildBat, '');

  const calls = [];
  const result = buildNativeBackends({
    repoRoot,
    engineRoot,
    hostPlatform: 'win32',
    hostArch: 'x64',
    runBuild({ configuration }) {
      calls.push(configuration);
      const dllPath = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealPackageInsightBackend', 'UnrealPackageInsightBackend.dll');
      fs.mkdirSync(path.dirname(dllPath), { recursive: true });
      fs.writeFileSync(dllPath, configuration);
      return dllPath;
    },
    smokeCheck() {
      return { ok: true };
    },
  });

  assert.deepEqual(calls, ['Debug', 'Development', 'Shipping']);
  assert.deepEqual(result.map((entry) => entry.manifest.id), [
    'ue-5.7.4-win32-x64-debug',
    'ue-5.7.4-win32-x64-development',
    'ue-5.7.4-win32-x64-shipping',
  ]);
  for (const entry of result) {
    assert.equal(fs.existsSync(path.join(entry.nativeDir, 'backend.json')), true);
    assert.equal(fs.existsSync(path.join(entry.nativeDir, 'UnrealPackageInsightBackend.dll')), true);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/build-native-backend-script.test.js
```

Expected: FAIL because `buildNativeBackends` and `findBuiltDll` are not exported.

- [ ] **Step 3: Implement script orchestration**

Extend `scripts/build-native-backend.js` with these functions:

```js
const { execFileSync } = require('node:child_process');

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function copyDirectory(source, destination) {
  removeDirectory(destination);
  fs.cpSync(source, destination, { recursive: true });
}

function findFiles(root, fileName, found = []) {
  if (!fs.existsSync(root)) {
    return found;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findFiles(entryPath, fileName, found);
    } else if (entry.isFile() && entry.name === fileName) {
      found.push(entryPath);
    }
  }
  return found;
}

function findBuiltDll(engineRoot) {
  const binariesDir = path.join(engineRoot, 'Engine', 'Binaries', 'Win64');
  const dlls = findFiles(binariesDir, BACKEND_DLL_NAME)
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (dlls.length === 0) {
    throw new Error(`Build completed but ${BACKEND_DLL_NAME} was not found under ${binariesDir}`);
  }
  return dlls[0].filePath;
}

function defaultRunBuild({ engineRoot, configuration }) {
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  execFileSync(buildBat, [
    'UnrealPackageInsightBackend',
    DEFAULT_UNREAL_PLATFORM,
    configuration,
    '-WaitMutex',
  ], { stdio: 'inherit' });
  return findBuiltDll(engineRoot);
}

function defaultSmokeCheck({ dllPath }) {
  if (!fs.existsSync(dllPath)) {
    throw new Error(`Staged DLL missing: ${dllPath}`);
  }
  return { ok: true };
}

function buildNativeBackends({
  repoRoot,
  engineRoot,
  configuration,
  hostPlatform = process.platform,
  hostArch = process.arch,
  runBuild = defaultRunBuild,
  smokeCheck = defaultSmokeCheck,
}) {
  if (!engineRoot) {
    throw new Error('Missing required --engine-root');
  }
  const sourceDir = path.join(repoRoot, 'ue-backend', 'UnrealPackageInsightBackend');
  const destinationDir = path.join(engineRoot, 'Engine', 'Source', 'Programs', 'UnrealPackageInsightBackend');
  copyDirectory(sourceDir, destinationDir);

  const engineVersion = readEngineVersion(engineRoot);
  const results = [];
  for (const buildConfiguration of resolveConfigurations({ configuration })) {
    const builtDll = runBuild({ engineRoot, configuration: buildConfiguration });
    const nativeDir = getNativeBackendDir({
      repoRoot,
      hostPlatform,
      hostArch,
      engineVersion,
      configuration: buildConfiguration,
    });
    ensureDirectory(nativeDir);
    const stagedDll = path.join(nativeDir, BACKEND_DLL_NAME);
    fs.copyFileSync(builtDll, stagedDll);
    const manifest = createBackendManifest({
      engineVersion,
      hostPlatform,
      hostArch,
      unrealPlatform: DEFAULT_UNREAL_PLATFORM,
      configuration: buildConfiguration,
    });
    fs.writeFileSync(path.join(nativeDir, 'backend.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    smokeCheck({ dllPath: stagedDll, manifest });
    results.push({ manifest, nativeDir, dllPath: stagedDll });
  }
  return results;
}
```

Add CLI entrypoint:

```js
function repoRootFromScript() {
  return path.resolve(__dirname, '..');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const results = buildNativeBackends({
    repoRoot: repoRootFromScript(),
    engineRoot: args.engineRoot,
    configuration: args.configuration,
  });
  for (const result of results) {
    console.log(`${result.manifest.id} ${result.nativeDir}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
```

End the file with this export block:

```js
module.exports = {
  ALL_CONFIGURATIONS,
  BACKEND_DLL_NAME,
  DEFAULT_UNREAL_PLATFORM,
  PROTOCOL_VERSION,
  buildNativeBackends,
  configurationKey,
  copyDirectory,
  createBackendManifest,
  defaultRunBuild,
  defaultSmokeCheck,
  findBuiltDll,
  findFiles,
  getNativeBackendDir,
  main,
  normalizeConfiguration,
  parseArgs,
  readEngineVersion,
  resolveConfigurations,
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/build-native-backend-script.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/build-native-backend.js node-shell/test/build-native-backend-script.test.js
git commit -m "Implement native backend build staging flow"
```

## Task 4: Backend Registry and Selector

**Files:**
- Create: `node-shell/packages/backend-core/src/backend-registry.js`
- Create: `node-shell/packages/backend-core/src/backend-selector.js`
- Test: `node-shell/packages/backend-core/test/backend-registry.test.js`
- Test: `node-shell/packages/backend-core/test/backend-selector.test.js`

- [ ] **Step 1: Write failing backend registry tests**

Create `node-shell/packages/backend-core/test/backend-registry.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadBackendManifests, summarizeBackends } = require('../src/backend-registry.js');

function writeBackend(nativeRoot, engineVersion, configurationKey) {
  const dir = path.join(nativeRoot, 'win32-x64', `ue-${engineVersion}`, configurationKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'UnrealPackageInsightBackend.dll'), '');
  fs.writeFileSync(path.join(dir, 'backend.json'), `${JSON.stringify({
    id: `ue-${engineVersion}-win32-x64-${configurationKey}`,
    engineVersion,
    hostPlatform: 'win32',
    hostArch: 'x64',
    unrealPlatform: 'Win64',
    configuration: configurationKey[0].toUpperCase() + configurationKey.slice(1),
    configurationKey,
    protocolVersion: 1,
    dll: 'UnrealPackageInsightBackend.dll',
    supports: {
      pak: { versionMin: 1, versionMax: 12 },
      iostore: { tocVersionMin: 1, tocVersionMax: 8 },
    },
  }, null, 2)}\n`);
}

test('loadBackendManifests scans current platform manifests and resolves DLL paths', (t) => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-native-root-'));
  t.after(() => fs.rmSync(nativeRoot, { recursive: true, force: true }));
  writeBackend(nativeRoot, '5.7.4', 'development');
  writeBackend(nativeRoot, '5.7.4', 'shipping');

  const manifests = loadBackendManifests({ nativeRoot, platform: 'win32', arch: 'x64' });

  assert.deepEqual(manifests.map((manifest) => manifest.id), [
    'ue-5.7.4-win32-x64-development',
    'ue-5.7.4-win32-x64-shipping',
  ]);
  assert.equal(manifests[0].dllPath.endsWith('UnrealPackageInsightBackend.dll'), true);
});

test('summarizeBackends returns registry summary for GUI header', (t) => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-native-root-'));
  t.after(() => fs.rmSync(nativeRoot, { recursive: true, force: true }));
  writeBackend(nativeRoot, '5.7.4', 'development');

  assert.deepEqual(summarizeBackends(loadBackendManifests({ nativeRoot, platform: 'win32', arch: 'x64' })), {
    status: 'OK',
    backendCount: 1,
    backends: [{
      id: 'ue-5.7.4-win32-x64-development',
      label: 'UE 5.7.4 Development',
      engineVersion: '5.7.4',
      configuration: 'Development',
    }],
  });
});
```

- [ ] **Step 2: Write failing backend selector tests**

Create `node-shell/packages/backend-core/test/backend-selector.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { selectBackendCandidates, sortBackendCandidates } = require('../src/backend-selector.js');

const manifests = [
  {
    id: 'ue-5.7.4-win32-x64-shipping',
    engineVersion: '5.7.4',
    configuration: 'Shipping',
    protocolVersion: 1,
    supports: { pak: { versionMin: 1, versionMax: 12 } },
  },
  {
    id: 'ue-5.7.4-win32-x64-development',
    engineVersion: '5.7.4',
    configuration: 'Development',
    protocolVersion: 1,
    supports: { pak: { versionMin: 1, versionMax: 12 } },
  },
  {
    id: 'ue-5.6.0-win32-x64-development',
    engineVersion: '5.6.0',
    configuration: 'Development',
    protocolVersion: 1,
    supports: { iostore: { tocVersionMin: 1, tocVersionMax: 8 } },
  },
];

test('selectBackendCandidates filters by container format version', () => {
  assert.deepEqual(
    selectBackendCandidates({ probe: { containerType: 'pak', pakFormatVersion: 12 }, manifests })
      .map((manifest) => manifest.id),
    [
      'ue-5.7.4-win32-x64-development',
      'ue-5.7.4-win32-x64-shipping',
    ],
  );
});

test('sortBackendCandidates prefers Development then newer engine version', () => {
  assert.deepEqual(
    sortBackendCandidates([...manifests]).map((manifest) => manifest.id),
    [
      'ue-5.7.4-win32-x64-development',
      'ue-5.6.0-win32-x64-development',
      'ue-5.7.4-win32-x64-shipping',
    ],
  );
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/backend-core/test/backend-registry.test.js packages/backend-core/test/backend-selector.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement registry and selector**

Create `node-shell/packages/backend-core/src/backend-registry.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

function defaultNativeRoot() {
  return path.join(__dirname, '..', '..', '..', 'native');
}

function assertManifest(manifest, manifestPath) {
  for (const key of ['id', 'engineVersion', 'hostPlatform', 'hostArch', 'configuration', 'configurationKey', 'protocolVersion', 'dll', 'supports']) {
    if (manifest[key] === undefined) {
      throw new Error(`backend.manifest_invalid: ${manifestPath} missing ${key}`);
    }
  }
}

function findManifestFiles(root, files = []) {
  if (!fs.existsSync(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findManifestFiles(entryPath, files);
    } else if (entry.isFile() && entry.name === 'backend.json') {
      files.push(entryPath);
    }
  }
  return files;
}

function loadBackendManifests({
  nativeRoot = defaultNativeRoot(),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return findManifestFiles(path.join(nativeRoot, `${platform}-${arch}`))
    .sort()
    .map((manifestPath) => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assertManifest(manifest, manifestPath);
      const dllPath = path.resolve(path.dirname(manifestPath), manifest.dll);
      if (!fs.existsSync(dllPath)) {
        throw new Error(`backend.manifest_invalid: DLL missing for ${manifest.id}: ${dllPath}`);
      }
      return { ...manifest, dllPath, manifestPath };
    });
}

function manifestLabel(manifest) {
  return `UE ${manifest.engineVersion} ${manifest.configuration}`;
}

function summarizeBackends(manifests) {
  return {
    status: 'OK',
    backendCount: manifests.length,
    backends: manifests.map((manifest) => ({
      id: manifest.id,
      label: manifestLabel(manifest),
      engineVersion: manifest.engineVersion,
      configuration: manifest.configuration,
    })),
  };
}

module.exports = {
  defaultNativeRoot,
  loadBackendManifests,
  manifestLabel,
  summarizeBackends,
};
```

Create `node-shell/packages/backend-core/src/backend-selector.js`:

```js
const PROTOCOL_VERSION = 1;

function parseVersion(version) {
  return String(version).split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function configurationRank(configuration) {
  return String(configuration).toLowerCase() === 'development' ? 0 : 1;
}

function sortBackendCandidates(manifests) {
  return manifests.sort((left, right) => (
    configurationRank(left.configuration) - configurationRank(right.configuration)
    || compareVersions(right.engineVersion, left.engineVersion)
    || left.id.localeCompare(right.id)
  ));
}

function supportsProbe(manifest, probe) {
  if (manifest.protocolVersion !== PROTOCOL_VERSION) {
    return false;
  }
  if (probe.containerType === 'pak') {
    const support = manifest.supports?.pak;
    return Boolean(support)
      && probe.pakFormatVersion >= support.versionMin
      && probe.pakFormatVersion <= support.versionMax;
  }
  if (probe.containerType === 'iostore') {
    const support = manifest.supports?.iostore;
    return Boolean(support)
      && probe.tocFormatVersion >= support.tocVersionMin
      && probe.tocFormatVersion <= support.tocVersionMax;
  }
  return false;
}

function selectBackendCandidates({ probe, manifests }) {
  return sortBackendCandidates(manifests.filter((manifest) => supportsProbe(manifest, probe)));
}

module.exports = {
  PROTOCOL_VERSION,
  compareVersions,
  selectBackendCandidates,
  sortBackendCandidates,
};
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/backend-core/test/backend-registry.test.js packages/backend-core/test/backend-selector.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add node-shell/packages/backend-core/src/backend-registry.js node-shell/packages/backend-core/src/backend-selector.js node-shell/packages/backend-core/test/backend-registry.test.js node-shell/packages/backend-core/test/backend-selector.test.js
git commit -m "Add backend manifest registry and selector"
```

## Task 5: Container Probe

**Files:**
- Create: `node-shell/packages/analysis-domain/src/container-probe.js`
- Test: `node-shell/packages/analysis-domain/test/container-probe.test.js`

- [ ] **Step 1: Write failing probe tests**

Create `node-shell/packages/analysis-domain/test/container-probe.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { probeContainerFile } = require('../src/container-probe.js');

function tempFile(t, fileName, buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

test('probes Pak footer magic and format version', (t) => {
  const buffer = Buffer.alloc(128);
  buffer.writeUInt32LE(0x5A6F12E1, 64);
  buffer.writeInt32LE(12, 68);
  const pakPath = tempFile(t, 'pakchunk0-Windows.pak', buffer);

  assert.deepEqual(probeContainerFile(pakPath), {
    containerType: 'pak',
    path: pakPath,
    pakFormatVersion: 12,
    pakFormatVersionName: 'PakFile_Version_Utf8PakDirectory',
  });
});

test('probes UTOC magic and TOC format version', (t) => {
  const buffer = Buffer.alloc(96);
  Buffer.from('-==--==--==--==-', 'ascii').copy(buffer, 0);
  buffer.writeUInt32LE(8, 16);
  buffer.writeUInt32LE(96, 20);
  buffer.writeUInt32LE(42, 24);
  buffer.writeUInt32LE(7, 28);
  buffer.writeUInt32LE(2, 48);
  const utocPath = tempFile(t, 'global.utoc', buffer);

  assert.deepEqual(probeContainerFile(utocPath), {
    containerType: 'iostore',
    path: utocPath,
    utocPath,
    tocFormatVersion: 8,
    tocFormatVersionName: 'ReplaceIoChunkHashWithIoHash',
    tocEntryCount: 42,
    compressionBlockEntryCount: 7,
    partitionCount: 2,
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/analysis-domain/test/container-probe.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal probe module**

Create `node-shell/packages/analysis-domain/src/container-probe.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const PAK_MAGIC = 0x5A6F12E1;
const UTOC_MAGIC = Buffer.from('-==--==--==--==-', 'ascii');

const PAK_VERSION_NAMES = new Map([
  [1, 'PakFile_Version_Initial'],
  [2, 'PakFile_Version_NoTimestamps'],
  [3, 'PakFile_Version_CompressionEncryption'],
  [4, 'PakFile_Version_IndexEncryption'],
  [5, 'PakFile_Version_RelativeChunkOffsets'],
  [6, 'PakFile_Version_DeleteRecords'],
  [7, 'PakFile_Version_EncryptionKeyGuid'],
  [8, 'PakFile_Version_FNameBasedCompressionMethod'],
  [9, 'PakFile_Version_FrozenIndex'],
  [10, 'PakFile_Version_PathHashIndex'],
  [11, 'PakFile_Version_Fnv64BugFix'],
  [12, 'PakFile_Version_Utf8PakDirectory'],
]);

const UTOC_VERSION_NAMES = new Map([
  [1, 'Initial'],
  [2, 'DirectoryIndex'],
  [3, 'PartitionSize'],
  [4, 'PerfectHash'],
  [5, 'PerfectHashWithOverflow'],
  [6, 'OnDemandMetaData'],
  [7, 'RemovedOnDemandMetaData'],
  [8, 'ReplaceIoChunkHashWithIoHash'],
]);

function ext(filePath) {
  return path.extname(filePath).toLowerCase();
}

function probePak(filePath) {
  const buffer = fs.readFileSync(filePath);
  const searchStart = Math.max(0, buffer.length - 512);
  for (let offset = searchStart; offset <= buffer.length - 8; offset += 1) {
    if (buffer.readUInt32LE(offset) === PAK_MAGIC) {
      const version = buffer.readInt32LE(offset + 4);
      return {
        containerType: 'pak',
        path: filePath,
        pakFormatVersion: version,
        pakFormatVersionName: PAK_VERSION_NAMES.get(version) || `PakFile_Version_${version}`,
      };
    }
  }
  throw new Error('probe.pak_footer_invalid');
}

function probeUtoc(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 52 || !buffer.subarray(0, UTOC_MAGIC.length).equals(UTOC_MAGIC)) {
    throw new Error('probe.utoc_header_invalid');
  }
  const tocFormatVersion = buffer.readUInt32LE(16);
  return {
    containerType: 'iostore',
    path: filePath,
    utocPath: filePath,
    tocFormatVersion,
    tocFormatVersionName: UTOC_VERSION_NAMES.get(tocFormatVersion) || `EIoStoreTocVersion_${tocFormatVersion}`,
    tocEntryCount: buffer.readUInt32LE(24),
    compressionBlockEntryCount: buffer.readUInt32LE(28),
    partitionCount: buffer.readUInt32LE(48),
  };
}

function probeContainerFile(filePath) {
  if (ext(filePath) === '.pak') {
    return probePak(filePath);
  }
  if (ext(filePath) === '.utoc') {
    return probeUtoc(filePath);
  }
  throw new Error('probe.unsupported_container');
}

module.exports = {
  PAK_MAGIC,
  UTOC_MAGIC,
  probeContainerFile,
  probePak,
  probeUtoc,
};
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/analysis-domain/test/container-probe.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add node-shell/packages/analysis-domain/src/container-probe.js node-shell/packages/analysis-domain/test/container-probe.test.js
git commit -m "Add JavaScript container probe"
```

## Task 6: Backend Client Provider and AnalysisService Lazy Routing

**Files:**
- Create: `node-shell/packages/backend-core/src/backend-client-provider.js`
- Test: `node-shell/packages/backend-core/test/backend-client-provider.test.js`
- Modify: `node-shell/packages/analysis-domain/src/analysis-service.js`
- Test: `node-shell/packages/analysis-domain/test/analysis-service.test.js`

- [ ] **Step 1: Write failing provider test**

Create `node-shell/packages/backend-core/test/backend-client-provider.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { createBackendClientProvider } = require('../src/backend-client-provider.js');

test('provider creates and caches clients by backend id', () => {
  const created = [];
  const provider = createBackendClientProvider({
    manifests: [
      { id: 'ue-5.7.4-win32-x64-development', dllPath: 'C:\\backend\\dev.dll' },
    ],
    koffi: {},
    backendClientFactory({ dllPath }) {
      created.push(dllPath);
      return { dllPath };
    },
    probeContainerFile() {
      return { containerType: 'pak', pakFormatVersion: 12 };
    },
  });

  assert.deepEqual(provider.getBackendClient('ue-5.7.4-win32-x64-development'), { dllPath: 'C:\\backend\\dev.dll' });
  assert.deepEqual(provider.getBackendClient('ue-5.7.4-win32-x64-development'), { dllPath: 'C:\\backend\\dev.dll' });
  assert.deepEqual(created, ['C:\\backend\\dev.dll']);
});

test('provider resolves a file through probe and selector when there is one candidate', async () => {
  const provider = createBackendClientProvider({
    manifests: [
      {
        id: 'ue-5.7.4-win32-x64-development',
        dllPath: 'C:\\backend\\dev.dll',
        engineVersion: '5.7.4',
        configuration: 'Development',
        protocolVersion: 1,
        supports: { pak: { versionMin: 1, versionMax: 12 } },
      },
    ],
    koffi: {},
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    backendClientFactory({ dllPath }) {
      return { dllPath };
    },
  });

  assert.deepEqual(await provider.resolveForFile('C:\\Paks\\pakchunk0-Windows.pak'), {
    backendId: 'ue-5.7.4-win32-x64-development',
    client: { dllPath: 'C:\\backend\\dev.dll' },
  });
});
```

- [ ] **Step 2: Add failing AnalysisService test**

Append to `node-shell/packages/analysis-domain/test/analysis-service.test.js`:

```js
test('resolves backend by selected Pak file and includes backend id in cache key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const calls = [];
  const service = new AnalysisService({
    backendClientProvider: {
      async resolveForFile(filePath) {
        assert.equal(filePath, pakPath);
        return {
          backendId: 'ue-5.7.4-win32-x64-development',
          client: {
            async analyzePak(request) {
              calls.push(request);
              return { status: 'OK', backendId: 'ue-5.7.4-win32-x64-development' };
            },
          },
        };
      },
    },
    filePaths: [pakPath],
  });

  const first = await service.analyze(pakPath);
  const second = await service.analyze(pakPath);

  assert.equal(first, second);
  assert.deepEqual(calls, [{ pakPath, aesKey: '' }]);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/backend-core/test/backend-client-provider.test.js packages/analysis-domain/test/analysis-service.test.js
```

Expected: FAIL because provider module and AnalysisService constructor option are missing.

- [ ] **Step 4: Implement provider**

Create `node-shell/packages/backend-core/src/backend-client-provider.js`:

```js
const { createBackendClient } = require('./backend-client.js');
const { selectBackendCandidates } = require('./backend-selector.js');

function createBackendClientProvider({
  manifests,
  koffi,
  backendClientFactory = createBackendClient,
  probeContainerFile,
  selectionStore = new Map(),
}) {
  if (typeof probeContainerFile !== 'function') {
    throw new Error('backend provider requires a probeContainerFile function');
  }
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const clients = new Map();
  return {
    setSelection(filePath, backendId) {
      selectionStore.set(filePath, backendId);
    },
    getManifest(id) {
      return byId.get(id) || null;
    },
    getBackendClient(id) {
      const manifest = byId.get(id);
      if (!manifest) {
        throw new Error(`backend.no_compatible_backend: ${id}`);
      }
      if (!clients.has(id)) {
        clients.set(id, backendClientFactory({ dllPath: manifest.dllPath, koffi }));
      }
      return clients.get(id);
    },
    async resolveForFile(filePath, filePaths = []) {
      const remembered = selectionStore.get(filePath);
      if (remembered) {
        return {
          backendId: remembered,
          client: this.getBackendClient(remembered),
        };
      }

      const probe = probeContainerFile(filePath, { filePaths });
      const candidates = selectBackendCandidates({ probe, manifests });
      if (candidates.length === 0) {
        const error = new Error('No compatible backend found.');
        error.code = 'backend.no_compatible_backend';
        error.probe = probe;
        throw error;
      }
      if (candidates.length > 1) {
        const error = new Error('Multiple compatible backends found.');
        error.code = 'backend.multiple_candidates';
        error.probe = probe;
        error.candidates = candidates.map((candidate) => ({
          id: candidate.id,
          label: `UE ${candidate.engineVersion} ${candidate.configuration}`,
        }));
        error.filePath = filePath;
        throw error;
      }
      return {
        backendId: candidates[0].id,
        client: this.getBackendClient(candidates[0].id),
      };
    },
  };
}

module.exports = { createBackendClientProvider };
```

- [ ] **Step 5: Update AnalysisService for lazy backend routing**

Modify `node-shell/packages/analysis-domain/src/analysis-service.js`:

```js
class AnalysisService {
  constructor({
    backendClient,
    backendClientProvider = null,
    filePaths,
    aesSession = new AesKeySession(),
    cache = new AnalysisCache(),
  }) {
    this.backendClient = backendClient;
    this.backendClientProvider = backendClientProvider;
    this.filePaths = filePaths || [];
    this.aesSession = aesSession;
    this.cache = cache;
  }

  async resolveBackend(filePath) {
    if (this.backendClientProvider) {
      return this.backendClientProvider.resolveForFile(filePath, this.filePaths);
    }
    return { backendId: 'legacy', client: this.backendClient };
  }
```

In `analyzePak`, before cache lookup:

```js
    const { backendId, client } = await this.resolveBackend(pakPath);
```

Use this cache key and call:

```js
    const cacheKey = this.cache.makeKey({
      analysisType: 'pak',
      paths: [pakPath],
      fileStamp: stamp,
      aesKey,
      backendId,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await client.analyzePak({ pakPath, aesKey });
    this.cache.set(cacheKey, result);
    return result;
```

In `analyzeIoStore`, after resolving pair and before cache lookup:

```js
    const { backendId, client } = await this.resolveBackend(utocPath);
```

Use this cache key and call:

```js
    const cacheKey = this.cache.makeKey({
      analysisType: 'iostore',
      paths: cachePaths,
      fileStamp: stamps.join('|'),
      aesKey,
      backendId,
    });
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = await client.analyzeIoStore({ utocPath, ucasPath, aesKey });
    this.cache.set(cacheKey, result);
    return result;
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- packages/backend-core/test/backend-client-provider.test.js packages/analysis-domain/test/analysis-service.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add node-shell/packages/backend-core/src/backend-client-provider.js node-shell/packages/backend-core/test/backend-client-provider.test.js node-shell/packages/analysis-domain/src/analysis-service.js node-shell/packages/analysis-domain/test/analysis-service.test.js
git commit -m "Route analysis through backend client provider"
```

## Task 7: GUI Startup, Registry Summary, and Backend Chooser IPC

**Files:**
- Modify: `node-shell/bin/upi-gui.js`
- Modify: `node-shell/apps/desktop/main.js`
- Modify: `node-shell/apps/desktop/preload.js`
- Modify: `node-shell/apps/desktop/renderer/index.html`
- Modify: `node-shell/apps/desktop/renderer/renderer.js`
- Modify: `node-shell/apps/desktop/renderer/styles.css`
- Test: `node-shell/test/desktop-main.test.js`
- Test: `node-shell/apps/desktop/test/main-ipc.test.js`
- Test: `node-shell/apps/desktop/test/renderer-static.test.js`

- [ ] **Step 1: Write failing GUI launcher test**

Append to `node-shell/test/desktop-main.test.js`:

```js
test('GUI launcher starts Electron without a DLL argument or backend env injection', () => {
  const child = new EventEmitter();
  const spawns = [];
  const processState = {};

  runGuiLauncher({
    argv: ['node', 'upi-gui.js'],
    env: { PATH: 'C:\\Windows\\System32' },
    electronPath: 'C:\\tools\\electron.cmd',
    spawnProcess: (...args) => {
      spawns.push(args);
      return child;
    },
    processController: processState,
  });

  assert.equal(spawns.length, 1);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_BACKEND_DLL'), false);
  assert.equal(Object.hasOwn(spawns[0][2].env, 'UPI_ENGINE_ROOT'), false);
});
```

- [ ] **Step 2: Write failing desktop IPC tests**

Append to `node-shell/apps/desktop/test/main-ipc.test.js`:

```js
test('backend:getInfo returns registry summary before any DLL is loaded', () => {
  const state = createDesktopState({
    backendRegistrySummary: {
      status: 'OK',
      backendCount: 1,
      backends: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
    },
  });
  const handlers = createIpcHandlers({ state });

  assert.deepEqual(handlers.getBackendInfo(), {
    status: 'OK',
    backendCount: 1,
    backends: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
  });
});

test('package:openDirectory creates AnalysisService with backendClientProvider', async () => {
  const backendClientProvider = { resolveForFile() {} };
  const state = createDesktopState({ backendClientProvider });
  const created = [];
  class FakeAnalysisService {
    constructor(options) {
      created.push(options);
    }
  }
  const handlers = createIpcHandlers({
    state,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: ['C:\\Paks'] }; } },
    scanPackageDirectory: async () => ({
      root: 'C:\\Paks',
      files: [{ path: 'C:\\Paks\\pakchunk0-Windows.pak' }],
      tree: { name: 'Paks', path: 'C:\\Paks', kind: 'directory', children: [] },
    }),
    AnalysisService: FakeAnalysisService,
  });

  await handlers.openPackageDirectory();

  assert.equal(created[0].backendClientProvider, backendClientProvider);
});
```

- [ ] **Step 3: Add failing renderer static test**

Append to `node-shell/apps/desktop/test/renderer-static.test.js`:

```js
test('renderer includes backend chooser dialog', () => {
  const html = readRendererFile('index.html');
  const script = readRendererFile('renderer.js');

  assert.match(html, /id="backend-dialog"/);
  assert.match(html, /id="backend-options"/);
  assert.match(script, /chooseBackend/);
});
```

- [ ] **Step 4: Run tests and verify they fail**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/desktop-main.test.js apps/desktop/test/main-ipc.test.js apps/desktop/test/renderer-static.test.js
```

Expected: FAIL because startup still resolves DLL and renderer has no chooser.

- [ ] **Step 5: Update GUI launcher**

Replace the DLL preflight in `node-shell/bin/upi-gui.js` with a plain Electron spawn:

```js
function main({
  argv = process.argv,
  env = process.env,
  spawnProcess = spawn,
  electronPath = require('electron'),
  reportError = console.error,
  processController = process,
} = {}) {
  const mainProcessPath = path.join(__dirname, '..', 'apps', 'desktop', 'main.js');
  const child = spawnProcess(electronPath, [mainProcessPath], {
    stdio: 'inherit',
    env: { ...env },
  });
```

Remove `koffi`, `DEFAULT_ENGINE_ROOT`, `buildDllSearchPath`, `resolveDllPath`, and `createBackendClient` imports from this file.

- [ ] **Step 6: Update desktop main state and handlers**

In `node-shell/apps/desktop/main.js`, replace eager backend initialization with registry/provider creation. The state factory should accept:

Import the probe from analysis-domain:

```js
const { probeContainerFile } = require('../../packages/analysis-domain/src/container-probe.js');
```

```js
function createDesktopState({
  backendClientProvider = null,
  backendRegistrySummary = { status: 'OK', backendCount: 0, backends: [] },
  backendSelections = new Map(),
  aesSession = new AesKeySession(),
} = {}) {
  return {
    aesSession,
    backendSelections,
    backendClientProvider,
    backendRegistrySummary,
    currentScan: null,
    analysisService: null,
  };
}
```

`getBackendInfo()` should return `state.backendRegistrySummary`. `openPackageDirectory()` should create `AnalysisServiceClass` with `backendClientProvider: state.backendClientProvider`. The provider consults `state.backendSelections` when resolving a file that the user has already chosen in this session.

In `analyze(filePath)`, catch backend selection errors before AES rejection handling:

```js
      let result;
      try {
        result = await state.analysisService.analyze(filePath);
      } catch (error) {
        if (error.code === 'backend.multiple_candidates') {
          return {
            status: 'Error',
            issues: [{
              severity: 'error',
              code: 'backend.multiple_candidates',
              message: error.message,
            }],
            backendSelection: {
              filePath: error.filePath,
              probe: error.probe,
              candidates: error.candidates,
            },
          };
        }
        if (error.code === 'backend.no_compatible_backend') {
          return {
            status: 'Error',
            issues: [{
              severity: 'error',
              code: 'backend.no_compatible_backend',
              message: error.message,
            }],
          };
        }
        throw error;
      }
```

Add an initializer:

```js
function initializeBackendRouting({
  state = desktopState,
  koffiModule = koffi,
  loadBackendManifestsFn = loadBackendManifests,
  probeContainerFileFn = probeContainerFile,
  summarizeBackendsFn = summarizeBackends,
  providerFactory = createBackendClientProvider,
} = {}) {
  const manifests = loadBackendManifestsFn();
  state.backendRegistrySummary = summarizeBackendsFn(manifests);
  state.backendClientProvider = providerFactory({
    manifests,
    koffi: koffiModule,
    probeContainerFile: probeContainerFileFn,
    selectionStore: state.backendSelections,
  });
  return state.backendClientProvider;
}
```

Call `initializeBackendRoutingFn({ state })` from `startDesktopApp` instead of `initializeBackendClientFn`.

- [ ] **Step 7: Add chooser bridge and dialog**

In `preload.js`:

```js
chooseBackend(request) {
  return ipcRenderer.invoke('backend:choose', request);
}
```

In `main.js`, add an IPC handler that records the renderer's selected backend id. The renderer
will make the actual choice:

```js
chooseBackend(request) {
  const selectedId = request?.selectedId || '';
  if (!selectedId) {
    return '';
  }
  state.backendSelections.set(request.filePath, selectedId);
  if (state.backendClientProvider && typeof state.backendClientProvider.setSelection === 'function') {
    state.backendClientProvider.setSelection(request.filePath, selectedId);
  }
  return selectedId;
}
```

Register it:

```js
ipcMainModule.handle('backend:choose', (_event, request) => handlers.chooseBackend(request));
```

In `renderer/index.html`, add:

```html
<dialog id="backend-dialog" class="backend-dialog">
  <form id="backend-form" method="dialog">
    <h2>Choose backend</h2>
    <p id="backend-message" class="dialog-text"></p>
    <div id="backend-options" class="backend-options"></div>
    <div class="dialog-actions">
      <button id="backend-cancel" type="button">Cancel</button>
      <button id="backend-submit" type="submit" class="primary-button">Use backend</button>
    </div>
  </form>
</dialog>
```

In `renderer.js`, bind the new elements:

```js
elements.backendDialog = document.getElementById('backend-dialog');
elements.backendForm = document.getElementById('backend-form');
elements.backendMessage = document.getElementById('backend-message');
elements.backendOptions = document.getElementById('backend-options');
elements.backendCancel = document.getElementById('backend-cancel');
elements.backendSubmit = document.getElementById('backend-submit');
```

Add this chooser function:

```js
async function chooseBackend(request) {
  replaceChildren(elements.backendOptions);
  elements.backendMessage.textContent = `${request.containerLabel || 'Container'} requires a backend.`;

  for (const candidate of request.candidates || []) {
    const label = document.createElement('label');
    label.className = 'backend-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'backend';
    input.value = candidate.id;
    if (!elements.backendOptions.querySelector('input[name="backend"]')) {
      input.checked = true;
    }
    const text = document.createElement('span');
    text.textContent = `${candidate.label} (${candidate.id})`;
    label.append(input, text);
    elements.backendOptions.appendChild(label);
  }

  const selectedId = await new Promise((resolve) => {
    const submit = (event) => {
      event.preventDefault();
      const selected = elements.backendOptions.querySelector('input[name="backend"]:checked');
      cleanup();
      resolve(selected ? selected.value : '');
    };
    const cancel = () => {
      cleanup();
      resolve('');
    };
    const cleanup = () => {
      elements.backendForm.removeEventListener('submit', submit);
      elements.backendCancel.removeEventListener('click', cancel);
      if (elements.backendDialog.open) {
        elements.backendDialog.close();
      }
    };
    elements.backendForm.addEventListener('submit', submit);
    elements.backendCancel.addEventListener('click', cancel);
    elements.backendDialog.showModal();
  });

  return window.upi.chooseBackend({ ...request, selectedId });
}
```

In `analyzeFile(filePath)`, before normal analysis rendering, handle backend selection:

```js
    if (result?.backendSelection) {
      const selectedBackendId = await chooseBackend(result.backendSelection);
      if (selectedBackendId && isCurrentAnalysis(filePath, requestId)) {
        analyzeFile(filePath);
      } else {
        renderAnalysis(result);
        setStatus('Backend selection canceled');
      }
      return;
    }
```

- [ ] **Step 8: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/desktop-main.test.js apps/desktop/test/main-ipc.test.js apps/desktop/test/renderer-static.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add node-shell/bin/upi-gui.js node-shell/apps/desktop/main.js node-shell/apps/desktop/preload.js node-shell/apps/desktop/renderer/index.html node-shell/apps/desktop/renderer/renderer.js node-shell/apps/desktop/renderer/styles.css node-shell/test/desktop-main.test.js node-shell/apps/desktop/test/main-ipc.test.js node-shell/apps/desktop/test/renderer-static.test.js
git commit -m "Load desktop backends lazily"
```

## Task 8: CLI Shared Routing

**Files:**
- Modify: `node-shell/src/index.js`
- Modify: `node-shell/bin/upi-cli.js`
- Test: `node-shell/test/cli-routing.test.js`

- [ ] **Step 1: Write failing CLI tests**

Create `node-shell/test/cli-routing.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { main } = require('../src/index.js');

test('list-backends prints manifest ids', () => {
  const output = [];
  const exitState = {};
  main({
    argv: ['node', 'index.js', 'list-backends'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: () => [
      { id: 'ue-5.7.4-win32-x64-development', engineVersion: '5.7.4', configuration: 'Development' },
    ],
  });

  assert.deepEqual(output, ['ue-5.7.4-win32-x64-development UE 5.7.4 Development']);
  assert.equal(exitState.exitCode ?? 0, 0);
});

test('analyze reports multiple candidates without backend id', async () => {
  const output = [];
  const exitState = {};
  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\pakchunk0-Windows.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    loadBackendManifests: () => [
      { id: 'a', engineVersion: '5.7.4', configuration: 'Development', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
      { id: 'b', engineVersion: '5.7.4', configuration: 'Shipping', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
    ],
  });

  assert.equal(exitState.exitCode, 1);
  assert.match(output.join('\n'), /Multiple compatible backends found/);
  assert.match(output.join('\n'), /--backend-id a/);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/cli-routing.test.js
```

Expected: FAIL because `main` does not accept dependency injection or commands.

- [ ] **Step 3: Implement CLI command parsing and shared routing**

Replace `node-shell/src/index.js` with command-oriented main:

```js
const koffi = require('koffi');

const { loadBackendManifests, manifestLabel } = require('../packages/backend-core/src/backend-registry.js');
const { createBackendClientProvider } = require('../packages/backend-core/src/backend-client-provider.js');
const { selectBackendCandidates } = require('../packages/backend-core/src/backend-selector.js');
const { probeContainerFile } = require('../packages/analysis-domain/src/container-probe.js');

function parseCli(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const rest = args.slice(1);
  const parsed = { command, filePath: '', backendId: '' };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--backend-id') {
      parsed.backendId = rest[index + 1] || '';
      index += 1;
    } else if (!parsed.filePath) {
      parsed.filePath = rest[index];
    } else {
      throw new Error(`Unexpected argument: ${rest[index]}`);
    }
  }
  return parsed;
}

async function main({
  argv = process.argv,
  log = console.log,
  processController = process,
  koffiModule = koffi,
  loadBackendManifests: loadManifests = loadBackendManifests,
  probeContainerFile: probe = probeContainerFile,
  providerFactory = createBackendClientProvider,
} = {}) {
  try {
    const args = parseCli(argv);
    const manifests = loadManifests();
    if (args.command === 'list-backends') {
      for (const manifest of manifests) {
        log(`${manifest.id} ${manifestLabel(manifest)}`);
      }
      return;
    }
    if (args.command === 'probe') {
      log(JSON.stringify(probe(args.filePath), null, 2));
      return;
    }
    if (args.command !== 'analyze') {
      log('Usage: node src/index.js <list-backends|probe|analyze> [file] [--backend-id <id>]');
      processController.exitCode = args.command === 'help' ? 0 : 1;
      return;
    }
    const probeResult = probe(args.filePath);
    const candidates = selectBackendCandidates({ probe: probeResult, manifests });
    if (candidates.length === 0) {
      log('No compatible backend found.');
      processController.exitCode = 1;
      return;
    }
    const selected = args.backendId
      ? candidates.find((candidate) => candidate.id === args.backendId)
      : candidates.length === 1 ? candidates[0] : null;
    if (!selected) {
      log('Multiple compatible backends found:');
      for (const candidate of candidates) {
        log(`  ${candidate.id} ${manifestLabel(candidate)}`);
      }
      log(`Run again with: --backend-id ${candidates[0].id}`);
      processController.exitCode = 1;
      return;
    }
    const provider = providerFactory({
      manifests: candidates,
      koffi: koffiModule,
      probeContainerFile: probe,
    });
    const client = provider.getBackendClient(selected.id);
    if (probeResult.containerType === 'pak') {
      log(JSON.stringify(await client.analyzePak({ pakPath: args.filePath, aesKey: '' }), null, 2));
    } else {
      log(JSON.stringify(await client.analyzeIoStore({ utocPath: probeResult.utocPath || args.filePath, ucasPath: '', aesKey: '' }), null, 2));
    }
  } catch (error) {
    log(error.message);
    processController.exitCode = 1;
  }
}
```

Update `node-shell/bin/upi-cli.js`:

```js
const { main } = require('../src/index.js');

if (require.main === module) {
  main();
}

module.exports = { main };
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/cli-routing.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add node-shell/src/index.js node-shell/bin/upi-cli.js node-shell/test/cli-routing.test.js
git commit -m "Route CLI analysis through backend manifests"
```

## Task 9: JavaScript Protocol Generation and PowerShell Cleanup

**Files:**
- Create: `scripts/generate-protocol.js`
- Modify: `node-shell/package.json`
- Delete: `scripts/stage-ue-backend.ps1`
- Delete: `scripts/build-ue-backend.ps1`
- Delete: `scripts/generate-protocol.ps1`
- Test: `node-shell/test/package-scripts.test.js`

- [ ] **Step 1: Write failing package script test**

Create `node-shell/test/package-scripts.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('node-shell generate-protocol uses JavaScript script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['generate-protocol'], 'node ../scripts/generate-protocol.js');
});

test('project scripts do not contain PowerShell files', () => {
  const scriptFiles = fs.readdirSync(path.resolve(__dirname, '..', '..', 'scripts'));
  assert.deepEqual(scriptFiles.filter((file) => file.endsWith('.ps1')), []);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/package-scripts.test.js
```

Expected: FAIL because package script still uses PowerShell and `.ps1` files exist.

- [ ] **Step 3: Create JS protocol script**

Create `scripts/generate-protocol.js` with this structure:

```js
#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_FLATC_VERSION = '24.3.25';
const SCHEMAS = [
  'upi_common.fbs',
  'upi_backend_info.fbs',
  'upi_pak_analysis.fbs',
  'upi_iostore_analysis.fbs',
];

function parseArgs(argv) {
  const args = { allowDifferentFlatcVersion: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--flatc') {
      args.flatc = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--allow-different-flatc-version') {
      args.allowDifferentFlatcVersion = true;
    } else {
      throw new Error(`Unexpected argument: ${argv[index]}`);
    }
  }
  return args;
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..');
}

function ensureEmptyDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function normalizeLineEndings(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      normalizeLineEndings(entryPath);
      continue;
    }
    const text = fs.readFileSync(entryPath, 'utf8');
    fs.writeFileSync(entryPath, text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  }
}

function setGeneratedTypescriptBarrel(barrelPath) {
  const exports = [
    "export { BackendInfoResponse } from './v1/backend-info-response.js';",
    "export { IoStoreAnalysisResponse } from './v1/io-store-analysis-response.js';",
    "export { IoStoreChunkEntry } from './v1/io-store-chunk-entry.js';",
    "export { IoStoreCompressedBlockEntry } from './v1/io-store-compressed-block-entry.js';",
    "export { IoStoreOverview } from './v1/io-store-overview.js';",
    "export { IoStorePackageEntry } from './v1/io-store-package-entry.js';",
    "export { IoStorePartition } from './v1/io-store-partition.js';",
    "export { Issue } from './v1/issue.js';",
    "export { IssueSeverity } from './v1/issue-severity.js';",
    "export { PakAnalysisResponse } from './v1/pak-analysis-response.js';",
    "export { PakCompressedBlockEntry } from './v1/pak-compressed-block-entry.js';",
    "export { PakOverview } from './v1/pak-overview.js';",
    "export { PakPackageEntry } from './v1/pak-package-entry.js';",
    "export { ResponseStatus } from './v1/response-status.js';",
  ];
  fs.writeFileSync(barrelPath, [
    '// automatically generated by the FlatBuffers compiler, do not modify',
    '',
    '/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */',
    '',
    ...exports,
    '',
  ].join('\n'));
}

function buildFlatcCommands({ flatc, protocolDir, cppOut, tsOut }) {
  const schemaPaths = SCHEMAS.map((schema) => path.join(protocolDir, schema));
  return [
    [flatc, ['--warnings-as-errors', '--cpp', '--filename-suffix', '_generated', '-o', cppOut, '-I', protocolDir, ...schemaPaths]],
    [flatc, ['--warnings-as-errors', '--ts', '-o', tsOut, '-I', protocolDir, ...schemaPaths]],
  ];
}
```

The `main` function should:

```js
function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const repoRoot = repoRootFromScript();
  const nodeShellDir = path.join(repoRoot, 'node-shell');
  const protocolDir = path.join(nodeShellDir, 'packages', 'protocol');
  const generatedDir = path.join(protocolDir, 'generated');
  const cppOut = path.join(generatedDir, 'cpp');
  const tsOut = path.join(generatedDir, 'ts');
  const jsOut = path.join(generatedDir, 'js');
  const flatc = args.flatc || process.env.UPI_FLATC || 'flatc';

  const versionOutput = execFileSync(flatc, ['--version'], { encoding: 'utf8' }).trim();
  const version = versionOutput.replace(/^flatc version\s+/, '');
  if (version !== REQUIRED_FLATC_VERSION && !args.allowDifferentFlatcVersion) {
    throw new Error(`flatc version ${version} is not supported. Expected ${REQUIRED_FLATC_VERSION}.`);
  }

  ensureEmptyDirectory(cppOut);
  ensureEmptyDirectory(tsOut);
  ensureEmptyDirectory(jsOut);

  for (const [command, commandArgs] of buildFlatcCommands({ flatc, protocolDir, cppOut, tsOut })) {
    execFileSync(command, commandArgs, { stdio: 'inherit' });
  }

  setGeneratedTypescriptBarrel(path.join(tsOut, 'upi', 'v1.ts'));

  const tsc = path.join(nodeShellDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const tsFiles = [];
  function collectTsFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectTsFiles(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        tsFiles.push(entryPath);
      }
    }
  }
  collectTsFiles(tsOut);

  execFileSync(tsc, [
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--rootDir', tsOut,
    '--outDir', jsOut,
    '--skipLibCheck',
    '--noEmitOnError',
    ...tsFiles,
  ], { stdio: 'inherit' });

  normalizeLineEndings(generatedDir);
  console.log(`[OK] Generated FlatBuffers bindings in ${generatedDir}`);
}
```

End the file with:

```js
module.exports = {
  REQUIRED_FLATC_VERSION,
  buildFlatcCommands,
  main,
  normalizeLineEndings,
  parseArgs,
  setGeneratedTypescriptBarrel,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
```

Argument compatibility remains:

```text
node scripts/generate-protocol.js --flatc C:\Tools\flatc.exe
node scripts/generate-protocol.js --allow-different-flatc-version
```

- [ ] **Step 4: Update package script and delete PowerShell scripts**

Modify `node-shell/package.json`:

```json
"generate-protocol": "node ../scripts/generate-protocol.js"
```

Delete:

```text
scripts/stage-ue-backend.ps1
scripts/build-ue-backend.ps1
scripts/generate-protocol.ps1
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test -- test/package-scripts.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts node-shell/package.json node-shell/test/package-scripts.test.js
git commit -m "Replace project PowerShell scripts with JavaScript"
```

## Task 10: Agent Workflow Documentation

**Files:**
- Create: `.agents/workflow/update-native-backend.md`
- Create: `AGENTS.md`

- [ ] **Step 1: Create workflow document**

Create `.agents/workflow/update-native-backend.md`:

```markdown
# Update Native Backend

Run this workflow after any change under:

- `ue-backend/**/*.cpp`
- `ue-backend/**/*.h`
- `ue-backend/**/*.cs`

## Build

Use the root npm command:

```powershell
npm run build -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

This builds and stages `Debug`, `Development`, and `Shipping` native backends for the engine
version in `Engine/Build/Build.version`.

For a single configuration during local iteration:

```powershell
npm run build:native:development -- --engine-root C:\WORKSPACE_UE\UnrealEngine
```

## Verify

Before finishing:

- confirm each expected `backend.json` exists,
- confirm each staged `UnrealPackageInsightBackend.dll` exists,
- confirm the build script smoke-check called `UPI_GetBackendInfoV1`,
- run `npm --prefix node-shell test`.

## Reporting

In the final response, state whether the native backend was rebuilt. If the build could not run
because the EngineRoot is unavailable or Unreal Build Tool failed, report the exact skipped
command and reason.
```

- [ ] **Step 2: Create repository AGENTS.md**

Create `AGENTS.md`:

```markdown
# Repository Agent Instructions

## C++ Backend Changes

Whenever modifying files under `ue-backend/**/*.cpp`, `ue-backend/**/*.h`, or
`ue-backend/**/*.cs`, follow `.agents/workflow/update-native-backend.md` before finishing.

Do not use project-local PowerShell scripts for backend staging, backend building, or protocol
generation. Use the root npm commands and JavaScript scripts.
```

- [ ] **Step 3: Commit**

```powershell
git add AGENTS.md .agents/workflow/update-native-backend.md
git commit -m "Document native backend update workflow"
```

## Task 11: Full Verification and Cleanup

**Files:**
- No new files unless tests reveal a necessary fix.

- [ ] **Step 1: Run the complete Node test suite**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight\node-shell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Verify no project PowerShell scripts remain**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
rg --files scripts | rg '\.ps1$'
```

Expected: no output.

- [ ] **Step 3: Verify runtime env names are no longer normal startup paths**

Run:

```powershell
Set-Location C:\WORKSPACE_UE\UnrealPackageInsight
rg -n 'UPI_BACKEND_DLL|UPI_ENGINE_ROOT|DEFAULT_ENGINE_ROOT' node-shell scripts AGENTS.md .agents
```

Expected: no runtime startup dependency remains. Mentions in historical docs under `docs/` do not block completion.

- [ ] **Step 4: Commit any final fixes**

If previous steps required fixes:

```powershell
git add <fixed-files>
git commit -m "Complete native backend routing cleanup"
```

If no fixes were needed, do not create an empty commit.
