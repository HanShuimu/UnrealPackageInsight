const fs = require('node:fs');
const path = require('node:path');

const { loadBackendManifests: defaultLoadBackendManifests } = require('../../backend-core/src/backend-registry.js');
const { createBackendClientProvider } = require('../../backend-core/src/backend-client-provider.js');
const { AesKeySession } = require('./aes-key-session.js');
const { AnalysisService: DefaultAnalysisService } = require('./analysis-service.js');
const { getContainerKind, resolveIoStoreSelection, stripIoStorePartitionSuffix } = require('./container-pairing.js');
const { probeContainerFile: defaultProbeContainerFile } = require('./container-probe.js');
const {
  buildPackageRows,
  serializePackagesCsv,
  sortPackageRows,
} = require('./packages-table-export.js');

const CONTAINER_EXTENSIONS = new Set(['.pak', '.utoc', '.ucas']);

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
}

function comparePaths(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isContainerFileName(fileName) {
  return CONTAINER_EXTENSIONS.has(path.win32.extname(fileName).toLowerCase());
}

function listSiblingContainerFiles(filePath, fsModule = fs) {
  assertNonEmptyString(filePath, 'filePath');
  const directory = path.win32.dirname(filePath);
  return fsModule.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isContainerFileName(entry.name))
    .map((entry) => path.win32.join(directory, entry.name))
    .sort(comparePaths);
}

function defaultKoffiModule() {
  return require('koffi');
}

function deriveUtocPathForUcas(filePath) {
  const directory = path.win32.dirname(filePath);
  const baseName = path.win32.basename(filePath, path.win32.extname(filePath));
  return path.win32.join(directory, `${stripIoStorePartitionSuffix(baseName)}.utoc`);
}

function resolveBackendSelectionPath(filePath, filePaths) {
  const kind = getContainerKind(filePath);
  if (kind === 'ucas') {
    const selection = resolveIoStoreSelection(filePath, filePaths);
    return selection?.ok ? selection.utocPath : deriveUtocPathForUcas(filePath);
  }
  return filePath;
}

function createContainerOperationContext(options = {}) {
  const {
    filePath,
    aesKey,
    backendId,
    filePaths,
    fsModule = fs,
    koffiModule,
    loadBackendManifests = defaultLoadBackendManifests,
    providerFactory = createBackendClientProvider,
    probeContainerFile = defaultProbeContainerFile,
    AnalysisService = DefaultAnalysisService,
  } = options;

  assertNonEmptyString(filePath, 'filePath');

  const aesSession = new AesKeySession();
  if (aesKey !== undefined) {
    aesSession.setKey(aesKey);
  }
  const resolvedFilePaths = Array.isArray(filePaths)
    ? filePaths
    : listSiblingContainerFiles(filePath, fsModule);

  const manifests = loadBackendManifests();
  const backendClientProvider = providerFactory({
    manifests,
    koffi: koffiModule || defaultKoffiModule(),
    probeContainerFile,
  });

  if (backendId !== undefined && backendId !== null && String(backendId).trim() !== '') {
    backendClientProvider.setSelection(resolveBackendSelectionPath(filePath, resolvedFilePaths), backendId);
  }

  const service = new AnalysisService({
    backendClientProvider,
    filePaths: resolvedFilePaths,
    aesSession,
  });

  return {
    filePath,
    filePaths: resolvedFilePaths,
    aesSession,
    manifests,
    backendClientProvider,
    service,
  };
}

async function analyzeContainer(options = {}) {
  const { createContext = createContainerOperationContext } = options;
  const context = await createContext(options);
  return context.service.analyze(context.filePath || options.filePath);
}

async function extractContainer(options = {}) {
  const { outputDirectory } = options;
  assertNonEmptyString(outputDirectory, 'outputDirectory');
  const { createContext = createContainerOperationContext } = options;
  const context = await createContext(options);
  return context.service.extract(context.filePath || options.filePath, outputDirectory);
}

function normalizeCsvOutputPath(filePath) {
  assertNonEmptyString(filePath, 'filePath');
  return path.win32.extname(filePath).toLowerCase() === '.csv' ? filePath : `${filePath}.csv`;
}

async function exportPackagesCsv(options = {}) {
  const {
    outputPath,
    writeFile = fs.promises.writeFile,
  } = options;

  assertNonEmptyString(outputPath, 'outputPath');

  const outputFilePath = normalizeCsvOutputPath(outputPath);
  const result = await analyzeContainer(options);
  const rows = sortPackageRows(buildPackageRows(result));
  if (rows.length === 0) {
    throw new Error('No packages to export.');
  }

  const csv = serializePackagesCsv(rows);
  await writeFile(outputFilePath, csv, 'utf8');

  return {
    status: 'OK',
    filePath: outputFilePath,
    packageCount: rows.length,
    byteCount: Buffer.byteLength(csv, 'utf8'),
    backendId: result?.backendId,
  };
}

module.exports = {
  analyzeContainer,
  createContainerOperationContext,
  exportPackagesCsv,
  extractContainer,
  listSiblingContainerFiles,
  normalizeCsvOutputPath,
};
