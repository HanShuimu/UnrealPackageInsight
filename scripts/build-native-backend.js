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
