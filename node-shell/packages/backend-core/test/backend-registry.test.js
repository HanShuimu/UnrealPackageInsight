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
