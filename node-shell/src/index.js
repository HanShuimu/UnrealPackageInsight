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

async function analyzeContainer({
  filePath,
  backendId,
  log,
  loadBackendManifests,
  probeContainerFile,
  providerFactory,
}) {
  const probe = probeContainerFile(filePath);
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
  const client = provider.getBackendClient(selected.id, { filePath });
  const result = probe.containerType === 'pak'
    ? await client.analyzePak({ pakPath: filePath, aesKey: '' })
    : await client.analyzeIoStore({ utocPath: probe.utocPath || filePath, aesKey: '' });

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
