const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ALL_CONFIGURATIONS,
  buildNativeBackends,
  createBackendManifest,
  defaultRunBuild,
  defaultSmokeCheck,
  ensureDirectory,
  findBuiltDll,
  getNativeBackendDir,
  parseArgs,
  readEngineVersion,
  removeDirectory,
  repoRootFromScript,
  resolveConfigurations,
  runBatchFile,
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

test('exports orchestration helper functions used by the build script', () => {
  assert.equal(typeof ensureDirectory, 'function');
  assert.equal(typeof removeDirectory, 'function');
  assert.equal(typeof repoRootFromScript, 'function');
});

test('findBuiltDll discovers the newest backend DLL under Engine/Binaries/Win64', (t) => {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-built-dll-'));
  t.after(() => fs.rmSync(engineRoot, { recursive: true, force: true }));
  const olderDllPath = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'OldBackend', 'UnrealPackageInsightBackend.dll');
  const newerDllPath = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealPackageInsightBackend', 'UnrealPackageInsightBackend.dll');
  fs.mkdirSync(path.dirname(olderDllPath), { recursive: true });
  fs.mkdirSync(path.dirname(newerDllPath), { recursive: true });
  fs.writeFileSync(olderDllPath, '');
  fs.writeFileSync(newerDllPath, '');
  const olderTime = new Date('2026-01-01T00:00:00.000Z');
  const newerTime = new Date('2026-01-01T00:01:00.000Z');
  fs.utimesSync(olderDllPath, olderTime, olderTime);
  fs.utimesSync(newerDllPath, newerTime, newerTime);

  assert.equal(findBuiltDll(engineRoot), newerDllPath);
});

test('buildNativeBackends preserves existing staged source when input validation fails', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-build-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const engineRoot = path.join(root, 'engine');
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

  assert.throws(() => buildNativeBackends({ repoRoot, engineRoot }), /UnrealPackageInsightBackend/);
  assert.equal(fs.existsSync(markerPath), true);
});

test('buildNativeBackends preserves existing staged source when configuration is invalid', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-build-config-guard-'));
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

  assert.throws(() => buildNativeBackends({ repoRoot, engineRoot, configuration: 'Nope' }), /Unsupported configuration: Nope/);
  assert.equal(fs.existsSync(markerPath), true);
});

test('defaultSmokeCheck loads the backend with a temporary build-time DLL search path', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-smoke-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const engineRoot = path.join(root, 'engine');
  const dllPath = path.join(root, 'native', 'UnrealPackageInsightBackend.dll');
  fs.mkdirSync(path.dirname(dllPath), { recursive: true });
  fs.writeFileSync(dllPath, '');
  const env = { PATH: 'C:\\Existing\\Bin' };
  const koffiModule = { fake: 'koffi' };
  const calls = [];
  const pathsDuringSmoke = [];
  const logs = [];

  const result = defaultSmokeCheck({
    dllPath,
    engineRoot,
    koffiModule,
    env,
    log(message) {
      logs.push(message);
    },
    smokeRunner(args) {
      calls.push(args);
      pathsDuringSmoke.push(env.PATH);
      args.log('smoked');
      return { ok: true };
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dllPath, dllPath);
  assert.equal(calls[0].koffi, koffiModule);
  assert.deepEqual(logs, ['smoked']);
  assert.equal(env.PATH, 'C:\\Existing\\Bin');
  const smokePathParts = pathsDuringSmoke[0].split(';');
  assert.equal(smokePathParts[0], path.win32.dirname(dllPath));
  assert.equal(smokePathParts[1], path.win32.join(engineRoot, 'Engine', 'Binaries', 'Win64'));
  assert.equal(smokePathParts[2], 'C:\\Existing\\Bin');
});

test('defaultRunBuild invokes Build.bat through cmd.exe and returns the built DLL', (t) => {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-run-build-'));
  t.after(() => fs.rmSync(engineRoot, { recursive: true, force: true }));
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  fs.mkdirSync(path.dirname(buildBat), { recursive: true });
  fs.writeFileSync(buildBat, '');
  const dllPath = path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealPackageInsightBackend', 'UnrealPackageInsightBackend.dll');
  const execCalls = [];

  const result = defaultRunBuild({
    engineRoot,
    configuration: 'Development',
    execFile(command, args, options) {
      execCalls.push({ command, args, options });
      fs.mkdirSync(path.dirname(dllPath), { recursive: true });
      fs.writeFileSync(dllPath, '');
    },
  });

  assert.equal(result, dllPath);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].command, 'cmd.exe');
  assert.deepEqual(execCalls[0].args, [
    '/d',
    '/s',
    '/c',
    'call',
    `"${buildBat}"`,
    'UnrealPackageInsightBackend',
    'Win64',
    'Development',
    '-WaitMutex',
  ]);
  assert.deepEqual(execCalls[0].options, { stdio: 'inherit', windowsVerbatimArguments: true });
});

test('runBatchFile executes a batch file from a path with spaces and preserves arguments', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi batch spaced '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const batchDir = path.join(root, 'Program Files', 'Epic Games');
  const batchPath = path.join(batchDir, 'Build.bat');
  const outputPath = path.join(root, 'received args.txt');
  fs.mkdirSync(batchDir, { recursive: true });
  fs.writeFileSync(batchPath, [
    '@echo off',
    '> "%~1" (',
    '  echo %~2',
    '  echo %~3',
    '  echo %~4',
    '  echo %~5',
    ')',
  ].join('\r\n'));

  runBatchFile(batchPath, [
    outputPath,
    'UnrealPackageInsightBackend',
    'Win64',
    'Development',
    'Arg With Spaces',
  ]);

  assert.deepEqual(fs.readFileSync(outputPath, 'utf8').trim().split(/\r?\n/), [
    'UnrealPackageInsightBackend',
    'Win64',
    'Development',
    'Arg With Spaces',
  ]);
});

test('buildNativeBackends preserves existing staged source when Build.bat is not a file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-build-bat-guard-'));
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
  fs.mkdirSync(buildBat, { recursive: true });

  assert.throws(() => buildNativeBackends({ repoRoot, engineRoot }), /Build\.bat/);
  assert.equal(fs.existsSync(markerPath), true);
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
  const smokeCalls = [];
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
    smokeCheck({ dllPath, manifest, engineRoot: smokeEngineRoot }) {
      smokeCalls.push({ dllPath, manifest, engineRoot: smokeEngineRoot });
      return { ok: true };
    },
  });

  assert.deepEqual(calls, ['Debug', 'Development', 'Shipping']);
  assert.deepEqual(result.map((entry) => entry.manifest.id), [
    'ue-5.7.4-win32-x64-debug',
    'ue-5.7.4-win32-x64-development',
    'ue-5.7.4-win32-x64-shipping',
  ]);
  assert.deepEqual(smokeCalls.map((entry) => entry.manifest.configuration), ['Debug', 'Development', 'Shipping']);
  assert.deepEqual(smokeCalls.map((entry) => entry.dllPath), result.map((entry) => entry.dllPath));
  assert.deepEqual(smokeCalls.map((entry) => entry.manifest.id), result.map((entry) => entry.manifest.id));
  assert.deepEqual(smokeCalls.map((entry) => entry.engineRoot), [engineRoot, engineRoot, engineRoot]);
  assert.equal(fs.existsSync(path.join(
    engineRoot,
    'Engine',
    'Source',
    'Programs',
    'UnrealPackageInsightBackend',
    'UnrealPackageInsightBackend.Target.cs',
  )), true);
  for (const entry of result) {
    assert.equal(fs.existsSync(path.join(entry.nativeDir, 'backend.json')), true);
    assert.equal(fs.existsSync(path.join(entry.nativeDir, 'UnrealPackageInsightBackend.dll')), true);
  }
});
