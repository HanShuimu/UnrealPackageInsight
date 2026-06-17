const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadBackendManifests, summarizeBackends } = require('../src/backend-registry.js');

function writeBackend(nativeRoot, engineVersion, configurationKey, overrides = {}) {
  const dir = path.join(nativeRoot, 'win32-x64', `ue-${engineVersion}`, configurationKey);
  fs.mkdirSync(dir, { recursive: true });
  if (overrides.writeDllAsDirectory) {
    fs.mkdirSync(path.join(dir, 'UnrealPackageInsightBackend.dll'));
  } else {
    fs.writeFileSync(path.join(dir, 'UnrealPackageInsightBackend.dll'), '');
  }
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
    ...overrides.manifest,
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

test('loadBackendManifests rejects manifests with mismatched host compatibility', (t) => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-native-root-'));
  t.after(() => fs.rmSync(nativeRoot, { recursive: true, force: true }));
  writeBackend(nativeRoot, '5.7.4', 'development', {
    manifest: { hostPlatform: 'linux', hostArch: 'arm64' },
  });

  assert.throws(
    () => loadBackendManifests({ nativeRoot, platform: 'win32', arch: 'x64' }),
    (error) => {
      assert.match(error.message, /backend\.manifest_invalid/);
      assert.match(error.message, /ue-5\.7\.4-win32-x64-development/);
      assert.match(error.message, /backend\.json/);
      assert.match(error.message, /hostPlatform/);
      assert.match(error.message, /hostArch/);
      return true;
    },
  );
});

test('loadBackendManifests rejects DLL paths that are not files', (t) => {
  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-native-root-'));
  t.after(() => fs.rmSync(nativeRoot, { recursive: true, force: true }));
  writeBackend(nativeRoot, '5.7.4', 'development', { writeDllAsDirectory: true });

  assert.throws(
    () => loadBackendManifests({ nativeRoot, platform: 'win32', arch: 'x64' }),
    /backend\.manifest_invalid: DLL missing for ue-5\.7\.4-win32-x64-development:/,
  );
});
