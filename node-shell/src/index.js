const fs = require('node:fs');
const path = require('node:path');

const koffi = require('koffi');

const {
  loadBackendManifests: defaultLoadBackendManifests,
  manifestLabel,
} = require('../packages/backend-core/src/backend-registry.js');
const {
  createBackendClientProvider,
} = require('../packages/backend-core/src/backend-client-provider.js');
const {
  selectBackendCandidates,
} = require('../packages/backend-core/src/backend-selector.js');
const {
  probeContainerFile: defaultProbeContainerFile,
} = require('../packages/analysis-domain/src/container-probe.js');
const {
  getContainerKind,
  resolveIoStoreSelection,
} = require('../packages/analysis-domain/src/container-pairing.js');

function parseCli(argv = process.argv) {
  const args = argv.slice(2);
  const [command] = args;

  if (command === 'list-backends') {
    return { command };
  }

  if (command === 'probe') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error('Usage: node src/index.js probe <file>');
    }
    return { command, filePath };
  }

  if (command === 'analyze') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error('Usage: node src/index.js analyze <file> [--backend-id <id>]');
    }

    let backendId;
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] !== '--backend-id') {
        throw new Error(`Unknown option: ${args[index]}`);
      }
      backendId = args[index + 1];
      if (!backendId) {
        throw new Error('Usage: node src/index.js analyze <file> [--backend-id <id>]');
      }
      index += 1;
    }

    return { command, filePath, backendId };
  }

  throw new Error([
    'Usage:',
    '  node src/index.js list-backends',
    '  node src/index.js probe <file>',
    '  node src/index.js analyze <file> [--backend-id <id>]',
  ].join('\n'));
}

function jsonStringify(value) {
  return JSON.stringify(value, (key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ));
}

function logCompatibleCandidates({ log, candidates }) {
  if (candidates.length > 1) {
    log('Multiple compatible backends found.');
  } else {
    log('Compatible backend does not match --backend-id.');
  }
  log('Compatible backends:');
  for (const candidate of candidates) {
    log(`  ${candidate.id} ${manifestLabel(candidate)}`);
  }
  if (candidates.length > 0) {
    log(`Run again with: --backend-id ${candidates[0].id}`);
  }
}

function defaultListContainerFiles(filePath) {
  const directory = path.win32.dirname(filePath);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.win32.join(directory, entry.name))
    .filter((candidatePath) => getContainerKind(candidatePath) !== 'unsupported');
}

function resolveAnalysisTarget({ filePath, filePaths, listContainerFiles }) {
  const kind = getContainerKind(filePath);
  if (kind === 'pak') {
    return {
      kind,
      probePath: filePath,
      pakPath: filePath,
    };
  }

  if (kind === 'utoc' || kind === 'ucas') {
    const availablePaths = filePaths || listContainerFiles(filePath);
    const selection = resolveIoStoreSelection(filePath, availablePaths);
    if (!selection?.ok) {
      throw new Error(selection?.issue?.message || 'Selected IoStore file is missing its matching .utoc or .ucas file.');
    }
    return {
      kind: 'iostore',
      probePath: selection.utocPath,
      utocPath: selection.utocPath,
      ucasPath: selection.ucasPath,
    };
  }

  return {
    kind,
    probePath: filePath,
  };
}

async function analyzeContainer({
  filePath,
  backendId,
  log,
  loadBackendManifests,
  probeContainerFile,
  providerFactory,
  filePaths,
  listContainerFiles,
}) {
  const target = resolveAnalysisTarget({ filePath, filePaths, listContainerFiles });
  const probe = probeContainerFile(target.probePath);
  const manifests = loadBackendManifests();
  const candidates = selectBackendCandidates({ probe, manifests });

  if (candidates.length === 0) {
    log('No compatible backend found.');
    return 1;
  }

  const selected = backendId
    ? candidates.find((candidate) => candidate.id === backendId)
    : candidates.length === 1 ? candidates[0] : null;

  if (!selected) {
    logCompatibleCandidates({ log, candidates });
    return 1;
  }

  const provider = providerFactory({
    manifests,
    koffi,
    probeContainerFile,
  });
  const client = provider.getBackendClient(selected.id, { filePath: target.probePath });
  const result = target.kind === 'pak'
    ? await client.analyzePak({ pakPath: target.pakPath, aesKey: '' })
    : await client.analyzeIoStore({
      utocPath: target.utocPath || probe.utocPath || target.probePath,
      ucasPath: target.ucasPath,
      aesKey: '',
    });

  log(jsonStringify(result));
  return 0;
}

async function main(options = {}) {
  const argv = Array.isArray(options) ? options : options.argv || process.argv;
  const log = Array.isArray(options) ? console.log : options.log || console.log;
  const processController = Array.isArray(options)
    ? process
    : options.processController || process;
  const loadBackendManifests = Array.isArray(options)
    ? defaultLoadBackendManifests
    : options.loadBackendManifests || defaultLoadBackendManifests;
  const probeContainerFile = Array.isArray(options)
    ? defaultProbeContainerFile
    : options.probeContainerFile || defaultProbeContainerFile;
  const providerFactory = Array.isArray(options)
    ? createBackendClientProvider
    : options.providerFactory || createBackendClientProvider;
  const filePaths = Array.isArray(options) ? undefined : options.filePaths;
  const listContainerFiles = Array.isArray(options)
    ? defaultListContainerFiles
    : options.listContainerFiles || defaultListContainerFiles;

  try {
    const parsed = parseCli(argv);

    if (parsed.command === 'list-backends') {
      for (const manifest of loadBackendManifests()) {
        log(`${manifest.id} ${manifestLabel(manifest)}`);
      }
      processController.exitCode = 0;
      return 0;
    }

    if (parsed.command === 'probe') {
      log(jsonStringify(probeContainerFile(parsed.filePath)));
      processController.exitCode = 0;
      return 0;
    }

    if (parsed.command === 'analyze') {
      const exitCode = await analyzeContainer({
        filePath: parsed.filePath,
        backendId: parsed.backendId,
        log,
        loadBackendManifests,
        probeContainerFile,
        providerFactory,
        filePaths,
        listContainerFiles,
      });
      processController.exitCode = exitCode;
      return exitCode;
    }
  } catch (error) {
    log(error.message);
    processController.exitCode = 1;
    return 1;
  }

  processController.exitCode = 1;
  return 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseCli,
};
