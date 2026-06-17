#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
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
