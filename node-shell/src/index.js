const {
  loadBackendManifests: defaultLoadBackendManifests,
  manifestLabel,
} = require('../packages/backend-core/src/backend-registry.js');
const {
  probeContainerFile: defaultProbeContainerFile,
} = require('../packages/analysis-domain/src/container-probe.js');

const COMMAND_USAGES = {
  'list-backends': 'Usage:\n  upi-cli list-backends',
  probe: 'Usage:\n  upi-cli probe <file>',
  analyze: 'Usage:\n  upi-cli analyze <file> [--backend-id <id>] [--aes-key <key>] [--pretty]',
  extract: 'Usage:\n  upi-cli extract <file> --out-dir <directory> [--backend-id <id>] [--aes-key <key>]',
  'export-csv': 'Usage:\n  upi-cli export-csv <file> --out <file.csv> [--backend-id <id>] [--aes-key <key>]',
};

const TOP_LEVEL_USAGE = [
  'Usage:',
  '  upi-cli --help',
  '  upi-cli help [command]',
  `  ${COMMAND_USAGES['list-backends'].split('\n  ')[1]}`,
  `  ${COMMAND_USAGES.probe.split('\n  ')[1]}`,
  `  ${COMMAND_USAGES.analyze.split('\n  ')[1]}`,
  `  ${COMMAND_USAGES.extract.split('\n  ')[1]}`,
  `  ${COMMAND_USAGES['export-csv'].split('\n  ')[1]}`,
].join('\n');

function requireValue(args, index, usage) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(usage);
  }
  return value;
}

function parseCommonOperationOptions(args, usage, { allowPretty = false } = {}) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === '--backend-id') {
      parsed.backendId = requireValue(args, index, usage);
      index += 1;
      continue;
    }

    if (option === '--aes-key') {
      parsed.aesKey = requireValue(args, index, usage);
      index += 1;
      continue;
    }

    if (allowPretty && option === '--pretty') {
      parsed.pretty = true;
      continue;
    }

    throw new Error(`Unknown option: ${option}`);
  }

  return parsed;
}

function parseCli(argv = process.argv) {
  const args = argv.slice(2);
  const [command] = args;

  if (command === '--help' || command === '-h' || command === 'help') {
    const parsed = { command: 'help' };
    if (command === 'help' && args[1] !== undefined) {
      parsed.topic = args[1];
    }
    return parsed;
  }

  if (command === 'list-backends') {
    if (args.length > 1) {
      throw new Error(COMMAND_USAGES['list-backends']);
    }
    return { command };
  }

  if (command === 'probe') {
    const filePath = args[1];
    if (!filePath || args.length > 2) {
      throw new Error(COMMAND_USAGES.probe);
    }
    return { command, filePath };
  }

  if (command === 'analyze') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error(COMMAND_USAGES.analyze);
    }
    return {
      command,
      filePath,
      ...parseCommonOperationOptions(args.slice(2), COMMAND_USAGES.analyze, { allowPretty: true }),
    };
  }

  if (command === 'extract') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error(COMMAND_USAGES.extract);
    }

    let outputDirectory;
    const rest = [];
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] === '--out-dir') {
        outputDirectory = requireValue(args, index, COMMAND_USAGES.extract);
        index += 1;
      } else {
        rest.push(args[index]);
      }
    }
    if (!outputDirectory) {
      throw new Error(COMMAND_USAGES.extract);
    }

    return {
      command,
      filePath,
      outputDirectory,
      ...parseCommonOperationOptions(rest, COMMAND_USAGES.extract),
    };
  }

  if (command === 'export-csv') {
    const filePath = args[1];
    if (!filePath) {
      throw new Error(COMMAND_USAGES['export-csv']);
    }

    let outputPath;
    const rest = [];
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] === '--out') {
        outputPath = requireValue(args, index, COMMAND_USAGES['export-csv']);
        index += 1;
      } else {
        rest.push(args[index]);
      }
    }
    if (!outputPath) {
      throw new Error(COMMAND_USAGES['export-csv']);
    }

    return {
      command,
      filePath,
      outputPath,
      ...parseCommonOperationOptions(rest, COMMAND_USAGES['export-csv']),
    };
  }

  throw new Error(TOP_LEVEL_USAGE);
}

function jsonStringify(value, pretty = false) {
  return JSON.stringify(
    value,
    (key, item) => (typeof item === 'bigint' ? item.toString() : item),
    pretty ? 2 : undefined,
  );
}

function defaultOperations() {
  return require('../packages/analysis-domain/src/container-operations.js');
}

function helpText(topic) {
  if (!topic) {
    return TOP_LEVEL_USAGE;
  }
  return COMMAND_USAGES[topic] || null;
}

function createOperationOptions(parsed, { loadBackendManifests, probeContainerFile }) {
  const operationOptions = {
    filePath: parsed.filePath,
    loadBackendManifests,
    probeContainerFile,
  };

  if (parsed.backendId !== undefined) {
    operationOptions.backendId = parsed.backendId;
  }
  if (parsed.aesKey !== undefined) {
    operationOptions.aesKey = parsed.aesKey;
  }
  if (parsed.outputDirectory !== undefined) {
    operationOptions.outputDirectory = parsed.outputDirectory;
  }
  if (parsed.outputPath !== undefined) {
    operationOptions.outputPath = parsed.outputPath;
  }

  return operationOptions;
}

function hasErrorIssue(result) {
  return Array.isArray(result?.issues)
    && result.issues.some((issue) => issue?.severity === 'error');
}

function exitCodeForOperationResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return 0;
  }

  if (result.status === 'Error') {
    return 1;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return 1;
  }
  if (typeof result.errorCount === 'number' && result.errorCount > 0) {
    return 1;
  }
  if (hasErrorIssue(result)) {
    return 1;
  }
  return 0;
}

function logOperationResult({ result, log, processController, pretty = false }) {
  const exitCode = exitCodeForOperationResult(result);
  log(jsonStringify(result, pretty));
  processController.exitCode = exitCode;
  return exitCode;
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

  try {
    const parsed = parseCli(argv);

    if (parsed.command === 'help') {
      const text = helpText(parsed.topic);
      if (!text) {
        log(`Unknown help topic: ${parsed.topic}\n${TOP_LEVEL_USAGE}`);
        processController.exitCode = 1;
        return 1;
      }
      log(text);
      processController.exitCode = 0;
      return 0;
    }

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

    const operations = Array.isArray(options)
      ? defaultOperations()
      : options.operations || defaultOperations();
    const operationOptions = createOperationOptions(parsed, {
      loadBackendManifests,
      probeContainerFile,
    });

    if (parsed.command === 'analyze') {
      const result = await operations.analyzeContainer(operationOptions);
      return logOperationResult({
        result,
        log,
        processController,
        pretty: parsed.pretty,
      });
    }

    if (parsed.command === 'extract') {
      const result = await operations.extractContainer(operationOptions);
      return logOperationResult({ result, log, processController });
    }

    if (parsed.command === 'export-csv') {
      const result = await operations.exportPackagesCsv(operationOptions);
      return logOperationResult({ result, log, processController });
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
