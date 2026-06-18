#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_FLATC_VERSION = '24.3.25';
const PROTOCOL_TOOLS_CONFIG = path.join('tools', 'protocol-tools.json');
const SCHEMAS = [
  'upi_common.fbs',
  'upi_backend_info.fbs',
  'upi_pak_analysis.fbs',
  'upi_iostore_analysis.fbs',
];

const TYPESCRIPT_BARREL_EXPORTS = [
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

function parseArgs(argv) {
  const parsed = { allowDifferentFlatcVersion: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--flatc') {
      const flatc = argv[index + 1];
      if (!flatc || flatc.startsWith('--')) {
        throw new Error('Missing value for --flatc');
      }
      parsed.flatc = flatc;
      index += 1;
      continue;
    }
    if (arg === '--tools-config') {
      const toolsConfig = argv[index + 1];
      if (!toolsConfig || toolsConfig.startsWith('--')) {
        throw new Error('Missing value for --tools-config');
      }
      parsed.toolsConfig = toolsConfig;
      index += 1;
      continue;
    }
    if (arg === '--allow-different-flatc-version') {
      parsed.allowDifferentFlatcVersion = true;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

function repoRootFromScript() {
  return path.resolve(__dirname, '..');
}

function getProtocolToolsConfigPath(repoRoot = repoRootFromScript(), explicitConfig) {
  if (explicitConfig) {
    return path.isAbsolute(explicitConfig)
      ? path.normalize(explicitConfig)
      : path.join(repoRoot, explicitConfig);
  }
  return path.join(repoRoot, PROTOCOL_TOOLS_CONFIG);
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} not found at ${filePath}.`);
    }
    throw new Error(`Failed to read ${label} at ${filePath}: ${error.message}`);
  }
}

function getPlatformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function resolveRepoPath(repoRoot, value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.join(repoRoot, value);
}

function getConfiguredFlatc({
  repoRoot = repoRootFromScript(),
  configPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const resolvedConfigPath = getProtocolToolsConfigPath(repoRoot, configPath);
  const config = readJsonFile(resolvedConfigPath, 'Protocol tools config');
  if (!config.flatc || typeof config.flatc !== 'object') {
    throw new Error(`Protocol tools config missing flatc section: ${resolvedConfigPath}.`);
  }

  const platformKey = getPlatformKey(platform, arch);
  return {
    version: config.flatc.version,
    executable: resolveRepoPath(repoRoot, config.flatc.path, 'flatc.path'),
    download: config.flatc.downloads?.[platformKey],
    platformKey,
  };
}

function resolveFlatcPath({
  repoRoot = repoRootFromScript(),
  explicitFlatc,
  configPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (explicitFlatc) {
    return explicitFlatc;
  }
  return getConfiguredFlatc({ repoRoot, configPath, platform, arch }).executable;
}

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

function removeLegacyCppOutput(paths) {
  fs.rmSync(path.join(paths.nodeGeneratedDir, 'cpp'), { recursive: true, force: true });
}

function ensureEmptyDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function collectFiles(root, predicate, found = []) {
  if (!fs.existsSync(root)) {
    return found;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath, predicate, found);
    } else if (entry.isFile() && predicate(entryPath)) {
      found.push(entryPath);
    }
  }
  return found;
}

function normalizeLineEndings(root) {
  for (const filePath of collectFiles(root, () => true)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalized !== text) {
      fs.writeFileSync(filePath, normalized, 'utf8');
    }
  }
}

function setGeneratedTypescriptBarrel(barrelPath) {
  const content = [
    '// automatically generated by the FlatBuffers compiler, do not modify',
    '',
    '/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */',
    '',
    ...TYPESCRIPT_BARREL_EXPORTS,
  ].join('\n');
  fs.writeFileSync(barrelPath, `${content}\n`, 'utf8');
}

function buildFlatcCommands({ flatc, protocolDir, cppOut, tsOut }) {
  const schemaPaths = SCHEMAS.map((schema) => path.join(protocolDir, schema));
  return [
    {
      executable: flatc,
      label: 'C++',
      args: [
        '--warnings-as-errors',
        '--cpp',
        '--filename-suffix',
        '_generated',
        '-o',
        cppOut,
        '-I',
        protocolDir,
        ...schemaPaths,
      ],
    },
    {
      executable: flatc,
      label: 'TypeScript',
      args: [
        '--warnings-as-errors',
        '--ts',
        '-o',
        tsOut,
        '-I',
        protocolDir,
        ...schemaPaths,
      ],
    },
  ];
}

function getFlatcVersion(flatc) {
  let output;
  try {
    output = execFileSync(flatc, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`flatc not found at ${flatc}. Run npm.cmd run ensure-flatc or pass --flatc <path>.`);
    }
    const details = [error.message, error.stderr?.toString(), error.stdout?.toString()]
      .filter(Boolean)
      .map((detail) => detail.trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(`flatc --version failed for ${flatc}.${details ? `\n${details}` : ''}`);
  }
  return output.trim().replace(/^flatc version\s+/, '');
}

function getTypescriptCompiler(nodeShellDir, platform = process.platform) {
  const compilerName = platform === 'win32' ? 'tsc.cmd' : 'tsc';
  const tsc = path.join(nodeShellDir, 'node_modules', '.bin', compilerName);
  if (!fs.existsSync(tsc) || !fs.statSync(tsc).isFile()) {
    throw new Error(`TypeScript compiler not found at ${tsc}. Run npm install from node-shell before generating protocol bindings.`);
  }
  return tsc;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const paths = getProtocolOutputPaths();
  const flatc = resolveFlatcPath({
    repoRoot: paths.repoRoot,
    explicitFlatc: args.flatc,
    configPath: args.toolsConfig,
  });

  const flatcVersion = getFlatcVersion(flatc);
  if ((flatcVersion !== REQUIRED_FLATC_VERSION) && !args.allowDifferentFlatcVersion) {
    throw new Error(`flatc version ${flatcVersion} is not supported. Expected ${REQUIRED_FLATC_VERSION}. Use --allow-different-flatc-version to override intentionally.`);
  }

  const tsc = getTypescriptCompiler(paths.nodeShellDir);

  removeLegacyCppOutput(paths);
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

  const tscArgs = [
    '--target',
    'ES2020',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--rootDir',
    paths.tsOut,
    '--outDir',
    paths.jsOut,
    '--skipLibCheck',
    '--noEmitOnError',
    ...tsFiles,
  ];

  try {
    execFileSync(tsc, tscArgs, {
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error('TypeScript compilation failed for generated protocol bindings.');
  }

  normalizeLineEndings(paths.cppOut);
  normalizeLineEndings(paths.nodeGeneratedDir);

  console.log(`[OK] Generated FlatBuffers bindings in ${paths.nodeGeneratedDir} and ${paths.cppOut}`);
}

module.exports = {
  REQUIRED_FLATC_VERSION,
  buildFlatcCommands,
  getConfiguredFlatc,
  getFlatcVersion,
  getProtocolOutputPaths,
  getProtocolToolsConfigPath,
  getTypescriptCompiler,
  main,
  normalizeLineEndings,
  parseArgs,
  removeLegacyCppOutput,
  resolveFlatcPath,
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
