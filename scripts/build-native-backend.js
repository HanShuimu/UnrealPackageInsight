#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { runBackendSmoke } = require('../node-shell/src/backend-runner');

const ALL_CONFIGURATIONS = ['Debug', 'Development', 'Shipping'];
const DEFAULT_UNREAL_PLATFORM = 'Win64';
const BACKEND_DLL_NAME = 'UnrealPackageInsightBackend.dll';
const PROTOCOL_VERSION = 1;
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;
const IMAGE_DIRECTORY_ENTRY_IMPORT = 1;
const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT = 13;
const REQUIRED_GENERATED_PROTOCOL_HEADERS = [
  'upi_backend_info_generated.h',
  'upi_common_generated.h',
  'upi_iostore_analysis_generated.h',
  'upi_pak_analysis_generated.h',
];

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

function getEngineBinariesDir(engineRoot) {
  return path.join(engineRoot, 'Engine', 'Binaries', 'Win64');
}

function readNullTerminatedAscii(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end += 1;
  }
  return buffer.toString('ascii', offset, end);
}

function createRvaResolver(sections) {
  return function resolveRva(rva) {
    for (const section of sections) {
      const sectionSize = Math.max(section.virtualSize, section.rawDataSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + sectionSize) {
        return section.rawDataPointer + (rva - section.virtualAddress);
      }
    }
    return null;
  };
}

function readPeMetadata(buffer, filePath) {
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`PE import scan failed for ${filePath}: missing MZ header`);
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    throw new Error(`PE import scan failed for ${filePath}: missing PE header`);
  }

  const coffOffset = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = buffer.readUInt16LE(coffOffset + 16);
  const optionalHeaderOffset = coffOffset + 20;
  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = magic === PE32_MAGIC
    ? optionalHeaderOffset + 96
    : magic === PE32_PLUS_MAGIC
      ? optionalHeaderOffset + 112
      : null;
  if (dataDirectoryOffset === null) {
    throw new Error(`PE import scan failed for ${filePath}: unsupported optional header`);
  }

  const sectionOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * 40;
    if (offset + 40 > buffer.length) {
      throw new Error(`PE import scan failed for ${filePath}: truncated section table`);
    }
    sections.push({
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawDataSize: buffer.readUInt32LE(offset + 16),
      rawDataPointer: buffer.readUInt32LE(offset + 20),
    });
  }

  return { dataDirectoryOffset, resolveRva: createRvaResolver(sections) };
}

function readDataDirectory(buffer, metadata, directoryIndex) {
  const offset = metadata.dataDirectoryOffset + directoryIndex * 8;
  if (offset + 8 > buffer.length) {
    return { rva: 0, size: 0 };
  }
  return {
    rva: buffer.readUInt32LE(offset),
    size: buffer.readUInt32LE(offset + 4),
  };
}

function descriptorIsEmpty(buffer, offset, size) {
  for (let index = 0; index < size; index += 4) {
    if (buffer.readUInt32LE(offset + index) !== 0) {
      return false;
    }
  }
  return true;
}

function readImportDescriptorNames({
  buffer,
  metadata,
  directoryIndex,
  descriptorSize,
  nameRvaOffset,
}) {
  const directory = readDataDirectory(buffer, metadata, directoryIndex);
  if (directory.rva === 0 || directory.size === 0) {
    return [];
  }
  const descriptorOffset = metadata.resolveRva(directory.rva);
  if (descriptorOffset === null) {
    return [];
  }

  const names = [];
  for (let offset = descriptorOffset; offset + descriptorSize <= buffer.length; offset += descriptorSize) {
    if (descriptorIsEmpty(buffer, offset, descriptorSize)) {
      break;
    }
    const nameRva = buffer.readUInt32LE(offset + nameRvaOffset);
    if (nameRva === 0) {
      continue;
    }
    const nameOffset = metadata.resolveRva(nameRva);
    if (nameOffset === null || nameOffset >= buffer.length) {
      continue;
    }
    const name = readNullTerminatedAscii(buffer, nameOffset);
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function readPeImportedDllNames(filePath) {
  const buffer = fs.readFileSync(filePath);
  const metadata = readPeMetadata(buffer, filePath);
  const names = [
    ...readImportDescriptorNames({
      buffer,
      metadata,
      directoryIndex: IMAGE_DIRECTORY_ENTRY_IMPORT,
      descriptorSize: 20,
      nameRvaOffset: 12,
    }),
    ...readImportDescriptorNames({
      buffer,
      metadata,
      directoryIndex: IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT,
      descriptorSize: 32,
      nameRvaOffset: 4,
    }),
  ];
  return Array.from(new Set(names));
}

function findDllFiles(root, found = []) {
  if (!fs.existsSync(root)) {
    return found;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findDllFiles(entryPath, found);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
      found.push(entryPath);
    }
  }
  return found;
}

function buildDllIndex(root) {
  const files = findDllFiles(root)
    .sort((left, right) => {
      const leftDepth = path.relative(root, left).split(path.sep).length;
      const rightDepth = path.relative(root, right).split(path.sep).length;
      return leftDepth - rightDepth || left.localeCompare(right);
    });
  const byName = new Map();
  for (const filePath of files) {
    const key = path.basename(filePath).toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, filePath);
    }
  }
  return byName;
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function stageRuntimeDependencies({
  entryDllPath,
  engineBinariesDir,
  destinationDir,
  readImportedDllNames = readPeImportedDllNames,
}) {
  const engineDlls = buildDllIndex(engineBinariesDir);
  const queue = [entryDllPath];
  const processed = new Set();
  const copiedByName = new Set();
  const copied = [];
  const missingByName = new Map();

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const currentKey = path.resolve(currentPath).toLowerCase();
    if (processed.has(currentKey)) {
      continue;
    }
    processed.add(currentKey);

    for (const importedName of readImportedDllNames(currentPath)) {
      if (!String(importedName).toLowerCase().endsWith('.dll')) {
        continue;
      }
      const importKey = path.basename(importedName).toLowerCase();
      const sourcePath = engineDlls.get(importKey);
      if (!sourcePath) {
        if (!missingByName.has(importKey)) {
          missingByName.set(importKey, importedName);
        }
        continue;
      }

      const destinationPath = path.join(destinationDir, path.basename(sourcePath));
      if (!samePath(sourcePath, destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
      if (!copiedByName.has(importKey)) {
        copiedByName.add(importKey);
        copied.push({
          name: path.basename(sourcePath),
          source: sourcePath,
          destination: destinationPath,
        });
      }
      queue.push(sourcePath);
    }
  }

  return {
    copied,
    missing: Array.from(missingByName.values()),
  };
}

function quoteBatchArgument(argument) {
  const value = String(argument);
  if (value.length === 0 || /[\s"&|<>^]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function runBatchFile(command, args, execFile = execFileSync) {
  execFile('cmd.exe', [
    '/d',
    '/s',
    '/c',
    'call',
    `"${command}"`,
    ...args.map(quoteBatchArgument),
  ], { stdio: 'inherit', windowsVerbatimArguments: true });
}

function defaultRunBuild({ engineRoot, configuration, execFile = execFileSync }) {
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  runBatchFile(buildBat, [
    'UnrealPackageInsightBackend',
    DEFAULT_UNREAL_PLATFORM,
    configuration,
    '-WaitMutex',
  ], execFile);
  return findBuiltDll(engineRoot);
}

function defaultSmokeCheck({
  dllPath,
  koffiModule = require(path.join(repoRootFromScript(), 'node-shell', 'node_modules', 'koffi')),
  smokeRunner = runBackendSmoke,
  log = console.log,
}) {
  if (!fs.existsSync(dllPath)) {
    throw new Error(`Staged DLL missing: ${dllPath}`);
  }
  const result = smokeRunner({ dllPath, koffi: koffiModule, log });
  const protocolVersion = result?.backendInfo?.protocolVersion;
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Backend protocol version ${protocolVersion} does not match expected ${PROTOCOL_VERSION}`);
  }
  return result;
}

function buildNativeBackends({
  repoRoot,
  engineRoot,
  configuration,
  hostPlatform = process.platform,
  hostArch = process.arch,
  runBuild = defaultRunBuild,
  smokeCheck = defaultSmokeCheck,
  stageRuntimeDependencies: stageRuntimeDependenciesFn = stageRuntimeDependencies,
}) {
  if (!engineRoot) {
    throw new Error('Missing required --engine-root');
  }
  const sourceDir = path.join(repoRoot, 'ue-backend', 'UnrealPackageInsightBackend');
  const destinationDir = path.join(engineRoot, 'Engine', 'Source', 'Programs', 'UnrealPackageInsightBackend');
  const buildBat = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Backend source directory missing: ${sourceDir}`);
  }
  const generatedProtocolDir = getProgramGeneratedProtocolDir(repoRoot);
  assertProgramGeneratedProtocolHeaders(generatedProtocolDir);
  const engineVersion = readEngineVersion(engineRoot);
  if (!fs.existsSync(buildBat) || !fs.statSync(buildBat).isFile()) {
    throw new Error(`Build.bat missing or not a file: ${buildBat}`);
  }
  fs.accessSync(buildBat, fs.constants.R_OK);
  const buildConfigurations = resolveConfigurations({ configuration });
  copyDirectory(sourceDir, destinationDir);

  const results = [];
  for (const buildConfiguration of buildConfigurations) {
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
    const runtimeDependencies = stageRuntimeDependenciesFn({
      entryDllPath: stagedDll,
      engineBinariesDir: getEngineBinariesDir(engineRoot),
      destinationDir: nativeDir,
    });
    const manifest = createBackendManifest({
      engineVersion,
      hostPlatform,
      hostArch,
      unrealPlatform: DEFAULT_UNREAL_PLATFORM,
      configuration: buildConfiguration,
    });
    fs.writeFileSync(path.join(nativeDir, 'backend.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    smokeCheck({ dllPath: stagedDll, engineRoot, manifest, runtimeDependencies });
    results.push({ manifest, nativeDir, dllPath: stagedDll, runtimeDependencies });
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
  REQUIRED_GENERATED_PROTOCOL_HEADERS,
  assertProgramGeneratedProtocolHeaders,
  buildNativeBackends,
  configurationKey,
  copyDirectory,
  createBackendManifest,
  defaultRunBuild,
  defaultSmokeCheck,
  ensureDirectory,
  findBuiltDll,
  findFiles,
  getEngineBinariesDir,
  getNativeBackendDir,
  getProgramGeneratedProtocolDir,
  main,
  normalizeConfiguration,
  parseArgs,
  readEngineVersion,
  readPeImportedDllNames,
  removeDirectory,
  repoRootFromScript,
  resolveConfigurations,
  runBatchFile,
  stageRuntimeDependencies,
};
