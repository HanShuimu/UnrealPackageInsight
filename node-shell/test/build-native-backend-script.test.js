const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALL_CONFIGURATIONS,
  buildNativeBackends,
  createBackendManifest,
  findBuiltDll,
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
