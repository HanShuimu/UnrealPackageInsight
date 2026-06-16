const { spawnSync } = require('node:child_process');
const path = require('node:path');

const flatbuffers = require('flatbuffers');

const {
  IoStoreAnalysisResponse,
  IoStoreOverview,
  IoStorePartition,
  Issue,
  IssueSeverity,
  ResponseStatus,
} = require('../../protocol/generated/js/upi/v1.js');
const { decodeIoStoreAnalysisResponse } = require('../../protocol/src/iostore-analysis-decoder.js');
const {
  DEFAULT_WORKER_MAX_BUFFER,
  DEFAULT_WORKER_TIMEOUT_MS,
} = require('./pak-analysis-worker-client.js');

const WORKER_RESULT_PREFIX = '__UPI_IOSTORE_ANALYSIS_RESULT__';

function deriveContainerBasePath({ utocPath, ucasPath }) {
  const sourcePath = utocPath || ucasPath || '';
  return sourcePath.replace(/(?:_s\d+)?\.(?:utoc|ucas)$/i, '');
}

function createIoStoreWorkerErrorResponse({ utocPath, ucasPath, code, message }) {
  const builder = new flatbuffers.Builder(512);
  const utocPathOffset = builder.createString(utocPath || '');
  const basePathOffset = builder.createString(deriveContainerBasePath({ utocPath, ucasPath }));
  const encryptionKeyGuidOffset = builder.createString('');
  const overview = IoStoreOverview.createIoStoreOverview(
    builder,
    utocPathOffset,
    basePathOffset,
    0n,
    0,
    0,
    0,
    0,
    ucasPath ? 1 : 0,
    0n,
    0,
    encryptionKeyGuidOffset,
    0,
    false,
    true,
  );

  const partitions = ucasPath
    ? IoStoreAnalysisResponse.createPartitionsVector(builder, [
      IoStorePartition.createIoStorePartition(builder, 0, builder.createString(ucasPath), 0n),
    ])
    : IoStoreAnalysisResponse.createPartitionsVector(builder, []);

  const codeOffset = builder.createString(code);
  const messageOffset = builder.createString(message);
  const issue = Issue.createIssue(builder, IssueSeverity.Error, codeOffset, messageOffset);
  const issues = IoStoreAnalysisResponse.createIssuesVector(builder, [issue]);
  const packages = IoStoreAnalysisResponse.createPackagesVector(builder, []);
  const chunks = IoStoreAnalysisResponse.createChunksVector(builder, []);
  const compressedBlocks = IoStoreAnalysisResponse.createCompressedBlocksVector(builder, []);
  IoStoreAnalysisResponse.startIoStoreAnalysisResponse(builder);
  IoStoreAnalysisResponse.addSchemaVersion(builder, 1);
  IoStoreAnalysisResponse.addStatus(builder, ResponseStatus.Error);
  IoStoreAnalysisResponse.addIssues(builder, issues);
  IoStoreAnalysisResponse.addOverview(builder, overview);
  IoStoreAnalysisResponse.addPartitions(builder, partitions);
  IoStoreAnalysisResponse.addPackages(builder, packages);
  IoStoreAnalysisResponse.addChunks(builder, chunks);
  IoStoreAnalysisResponse.addCompressedBlocks(builder, compressedBlocks);
  const response = IoStoreAnalysisResponse.endIoStoreAnalysisResponse(builder);
  IoStoreAnalysisResponse.finishIoStoreAnalysisResponseBuffer(builder, response);

  return decodeIoStoreAnalysisResponse(Buffer.from(builder.asUint8Array()));
}

function serializeWorkerPayload({ dllPath, utocPath, ucasPath, aesKey }) {
  return JSON.stringify({
    dllPath,
    utocPath,
    ucasPath,
    aesKey: aesKey ?? '',
  });
}

function defaultWorkerPath() {
  return path.join(__dirname, 'iostore-analysis-worker.js');
}

function workerExitDescription(result) {
  if (result.error) {
    return result.error.message;
  }

  if (result.signal) {
    return `signal ${result.signal}`;
  }

  return `exit code ${result.status}`;
}

function isWorkerTimeout(result) {
  return result && result.error && result.error.code === 'ETIMEDOUT';
}

function findWorkerResult(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith(WORKER_RESULT_PREFIX));
}

function parseWorkerResult({ utocPath, ucasPath, stdout }) {
  const resultLine = findWorkerResult(stdout);
  if (!resultLine) {
    return createIoStoreWorkerErrorResponse({
      utocPath,
      ucasPath,
      code: 'iostore.worker_protocol_error',
      message: 'IoStore analysis worker exited without returning a response.',
    });
  }

  let payload;
  try {
    payload = JSON.parse(resultLine.slice(WORKER_RESULT_PREFIX.length));
  } catch (error) {
    return createIoStoreWorkerErrorResponse({
      utocPath,
      ucasPath,
      code: 'iostore.worker_protocol_error',
      message: `IoStore analysis worker returned invalid JSON: ${error.message}`,
    });
  }

  if (!payload || payload.ok !== true || typeof payload.buffer !== 'string') {
    return createIoStoreWorkerErrorResponse({
      utocPath,
      ucasPath,
      code: 'iostore.worker_failed',
      message: payload && payload.error ? payload.error : 'IoStore analysis worker failed.',
    });
  }

  try {
    return decodeIoStoreAnalysisResponse(Buffer.from(payload.buffer, 'base64'));
  } catch (error) {
    return createIoStoreWorkerErrorResponse({
      utocPath,
      ucasPath,
      code: 'iostore.worker_protocol_error',
      message: `IoStore analysis worker returned an invalid IoStoreAnalysisResponse: ${error.message}`,
    });
  }
}

function analyzeIoStoreInWorker({
  dllPath,
  utocPath,
  ucasPath,
  aesKey = '',
  nodePath = process.execPath,
  workerPath = defaultWorkerPath(),
  spawnSync: spawnSyncImpl = spawnSync,
  env = process.env,
  timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  maxBuffer = DEFAULT_WORKER_MAX_BUFFER,
}) {
  const result = spawnSyncImpl(
    nodePath,
    [workerPath],
    {
      encoding: 'utf8',
      env,
      // Keep AES keys out of argv; Windows process command lines are observable.
      input: serializeWorkerPayload({ dllPath, utocPath, ucasPath, aesKey }),
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
    }
  );

  if (result.error || result.status !== 0 || result.signal) {
    if (isWorkerTimeout(result)) {
      return createIoStoreWorkerErrorResponse({
        utocPath,
        ucasPath,
        code: 'iostore.worker_timeout',
        message: `IoStore analysis worker timed out after ${timeoutMs} ms.`,
      });
    }

    return createIoStoreWorkerErrorResponse({
      utocPath,
      ucasPath,
      code: 'iostore.worker_failed',
      message: `IoStore analysis worker failed with ${workerExitDescription(result)}.`,
    });
  }

  return parseWorkerResult({ utocPath, ucasPath, stdout: result.stdout });
}

module.exports = {
  WORKER_RESULT_PREFIX,
  analyzeIoStoreInWorker,
  createIoStoreWorkerErrorResponse,
  parseWorkerResult,
  serializeWorkerPayload,
};
