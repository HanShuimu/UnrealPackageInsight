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
