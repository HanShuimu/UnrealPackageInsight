const { spawnSync } = require('node:child_process');
const path = require('node:path');

const flatbuffers = require('flatbuffers');

const {
  Issue,
  IssueSeverity,
  PakAnalysisResponse,
  PakOverview,
  ResponseStatus,
} = require('../../protocol/generated/js/upi/v1.js');
const { decodePakAnalysisResponse } = require('../../protocol/src/pak-analysis-decoder.js');

const WORKER_RESULT_PREFIX = '__UPI_PAK_ANALYSIS_RESULT__';

function createPakWorkerErrorResponse({ pakPath, code, message }) {
  const builder = new flatbuffers.Builder(256);
  const pakPathOffset = builder.createString(pakPath || '');
  const mountPointOffset = builder.createString('');
  const encryptionKeyGuidOffset = builder.createString('');
  const overview = PakOverview.createPakOverview(
    builder,
    pakPathOffset,
    mountPointOffset,
    0,
    0n,
    false,
    encryptionKeyGuidOffset,
    false,
    true,
    0,
    0
  );

  const codeOffset = builder.createString(code);
  const messageOffset = builder.createString(message);
  const issue = Issue.createIssue(builder, IssueSeverity.Error, codeOffset, messageOffset);
  const issues = PakAnalysisResponse.createIssuesVector(builder, [issue]);
  const packages = PakAnalysisResponse.createPackagesVector(builder, []);
  const compressedBlocks = PakAnalysisResponse.createCompressedBlocksVector(builder, []);
  PakAnalysisResponse.startPakAnalysisResponse(builder);
  PakAnalysisResponse.addSchemaVersion(builder, 1);
  PakAnalysisResponse.addStatus(builder, ResponseStatus.Error);
  PakAnalysisResponse.addIssues(builder, issues);
  PakAnalysisResponse.addOverview(builder, overview);
  PakAnalysisResponse.addPackages(builder, packages);
  PakAnalysisResponse.addCompressedBlocks(builder, compressedBlocks);
  const response = PakAnalysisResponse.endPakAnalysisResponse(builder);
  PakAnalysisResponse.finishPakAnalysisResponseBuffer(builder, response);

  return decodePakAnalysisResponse(Buffer.from(builder.asUint8Array()));
}

function encodeWorkerPayload({ dllPath, pakPath, aesKey }) {
  return Buffer.from(JSON.stringify({
    dllPath,
    pakPath,
    aesKey: aesKey ?? '',
  }), 'utf8').toString('base64');
}

function defaultWorkerPath() {
  return path.join(__dirname, 'pak-analysis-worker.js');
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

function findWorkerResult(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith(WORKER_RESULT_PREFIX));
}

function parseWorkerResult({ pakPath, stdout }) {
  const resultLine = findWorkerResult(stdout);
  if (!resultLine) {
    return createPakWorkerErrorResponse({
      pakPath,
      code: 'pak.worker_protocol_error',
      message: 'Pak analysis worker exited without returning a response.',
    });
  }

  let payload;
  try {
    payload = JSON.parse(resultLine.slice(WORKER_RESULT_PREFIX.length));
  } catch (error) {
    return createPakWorkerErrorResponse({
      pakPath,
      code: 'pak.worker_protocol_error',
      message: `Pak analysis worker returned invalid JSON: ${error.message}`,
    });
  }

  if (!payload || payload.ok !== true || typeof payload.buffer !== 'string') {
    return createPakWorkerErrorResponse({
      pakPath,
      code: 'pak.worker_failed',
      message: payload && payload.error ? payload.error : 'Pak analysis worker failed.',
    });
  }

  try {
    return decodePakAnalysisResponse(Buffer.from(payload.buffer, 'base64'));
  } catch (error) {
    return createPakWorkerErrorResponse({
      pakPath,
      code: 'pak.worker_protocol_error',
      message: `Pak analysis worker returned an invalid PakAnalysisResponse: ${error.message}`,
    });
  }
}

function analyzePakInWorker({
  dllPath,
  pakPath,
  aesKey = '',
  nodePath = process.execPath,
  workerPath = defaultWorkerPath(),
  spawnSync: spawnSyncImpl = spawnSync,
  env = process.env,
}) {
  const result = spawnSyncImpl(
    nodePath,
    [workerPath, encodeWorkerPayload({ dllPath, pakPath, aesKey })],
    {
      encoding: 'utf8',
      env,
      windowsHide: true,
    }
  );

  if (result.error || result.status !== 0 || result.signal) {
    return createPakWorkerErrorResponse({
      pakPath,
      code: 'pak.worker_failed',
      message: `Pak analysis worker failed with ${workerExitDescription(result)}.`,
    });
  }

  return parseWorkerResult({ pakPath, stdout: result.stdout });
}

module.exports = {
  WORKER_RESULT_PREFIX,
  analyzePakInWorker,
  createPakWorkerErrorResponse,
  encodeWorkerPayload,
  parseWorkerResult,
};
