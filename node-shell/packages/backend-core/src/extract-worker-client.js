const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { ResponseStatus, IssueSeverity } = require('../../protocol/generated/js/upi/v1.js');
const { createWorkerEnv } = require('./pak-analysis-worker-client.js');

const PAK_EXTRACT_RESULT_PREFIX = '__UPI_PAK_EXTRACT_RESULT__';
const IOSTORE_EXTRACT_RESULT_PREFIX = '__UPI_IOSTORE_EXTRACT_RESULT__';
const DEFAULT_EXTRACT_WORKER_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EXTRACT_WORKER_MAX_BUFFER = 64 * 1024 * 1024;

function containerPathForPayload(kind, payload) {
  if (kind === 'iostore') {
    return payload.utocPath || payload.ucasPath || '';
  }
  return payload.pakPath || '';
}

function createExtractWorkerErrorResponse({ kind, payload, code, message }) {
  return {
    schemaVersion: 1,
    status: ResponseStatus.Error,
    issues: [{
      severity: IssueSeverity.Error,
      code,
      message,
    }],
    containerPath: containerPathForPayload(kind, payload || {}),
    outputDirectory: payload?.outputDirectory || '',
    extractedFileCount: 0,
    errorCount: 1,
  };
}

function serializePakExtractPayload({ dllPath, pakPath, outputDirectory, aesKey }) {
  return JSON.stringify({
    dllPath,
    pakPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
}

function serializeIoStoreExtractPayload({ dllPath, utocPath, ucasPath, outputDirectory, aesKey }) {
  return JSON.stringify({
    dllPath,
    utocPath,
    ucasPath,
    outputDirectory,
    aesKey: aesKey ?? '',
  });
}

function defaultPakExtractWorkerPath() {
  return path.join(__dirname, 'pak-extract-worker.js');
}

function defaultIoStoreExtractWorkerPath() {
  return path.join(__dirname, 'iostore-extract-worker.js');
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

function findWorkerResult(stdout, resultPrefix) {
  return String(stdout || '')
    .split(/\r?\n/)
    .find((line) => line.startsWith(resultPrefix));
}

function extractResponseValidationError(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return 'expected an object';
  }

  const requiredFields = [
    ['schemaVersion', 'number'],
    ['status', 'number'],
    ['issues', 'array'],
    ['containerPath', 'string'],
    ['outputDirectory', 'string'],
    ['extractedFileCount', 'number'],
    ['errorCount', 'number'],
  ];

  for (const [fieldName, expectedType] of requiredFields) {
    if (expectedType === 'array') {
      if (!Array.isArray(response[fieldName])) {
        return `${fieldName} must be an array`;
      }
      continue;
    }

    if (typeof response[fieldName] !== expectedType) {
      return `${fieldName} must be a ${expectedType}`;
    }
  }

  return null;
}

function isExtractResponseLike(response) {
  return extractResponseValidationError(response) === null;
}

function parseExtractWorkerResult({ kind, resultPrefix, payload, stdout }) {
  const resultLine = findWorkerResult(stdout, resultPrefix);
  if (!resultLine) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker exited without returning a response.`,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(resultLine.slice(resultPrefix.length));
  } catch (error) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker returned invalid JSON: ${error.message}`,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker returned invalid result payload.`,
    });
  }

  if (parsed.ok === true && !isExtractResponseLike(parsed.response)) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_protocol_error`,
      message: `${kind} extract worker returned invalid extract response: ${extractResponseValidationError(parsed.response)}.`,
    });
  }

  if (parsed.ok !== true || !parsed.response) {
    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_failed`,
      message: parsed && parsed.error ? parsed.error : `${kind} extract worker failed.`,
    });
  }

  return parsed.response;
}

function runExtractWorker({
  kind,
  resultPrefix,
  payload,
  workerPath,
  nodePath = process.execPath,
  spawnSync: spawnSyncImpl = spawnSync,
  env = process.env,
  timeoutMs = DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  maxBuffer = DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
}) {
  const serialized = kind === 'iostore'
    ? serializeIoStoreExtractPayload(payload)
    : serializePakExtractPayload(payload);
  const result = spawnSyncImpl(nodePath, [workerPath], {
    encoding: 'utf8',
    env: createWorkerEnv(env),
    input: serialized,
    timeout: timeoutMs,
    maxBuffer,
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || result.signal) {
    if (isWorkerTimeout(result)) {
      return createExtractWorkerErrorResponse({
        kind,
        payload,
        code: `${kind}.extract_worker_timeout`,
        message: `${kind} extract worker timed out after ${timeoutMs} ms.`,
      });
    }

    if (findWorkerResult(result.stdout, resultPrefix)) {
      return parseExtractWorkerResult({ kind, resultPrefix, payload, stdout: result.stdout });
    }

    return createExtractWorkerErrorResponse({
      kind,
      payload,
      code: `${kind}.extract_worker_failed`,
      message: `${kind} extract worker failed with ${workerExitDescription(result)}.`,
    });
  }

  return parseExtractWorkerResult({ kind, resultPrefix, payload, stdout: result.stdout });
}

function extractPakInWorker(options) {
  return runExtractWorker({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    payload: {
      dllPath: options.dllPath,
      pakPath: options.pakPath,
      outputDirectory: options.outputDirectory,
      aesKey: options.aesKey ?? '',
    },
    workerPath: options.workerPath || defaultPakExtractWorkerPath(),
    nodePath: options.nodePath,
    spawnSync: options.spawnSync,
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxBuffer: options.maxBuffer,
  });
}

function extractIoStoreInWorker(options) {
  return runExtractWorker({
    kind: 'iostore',
    resultPrefix: IOSTORE_EXTRACT_RESULT_PREFIX,
    payload: {
      dllPath: options.dllPath,
      utocPath: options.utocPath,
      ucasPath: options.ucasPath,
      outputDirectory: options.outputDirectory,
      aesKey: options.aesKey ?? '',
    },
    workerPath: options.workerPath || defaultIoStoreExtractWorkerPath(),
    nodePath: options.nodePath,
    spawnSync: options.spawnSync,
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxBuffer: options.maxBuffer,
  });
}

module.exports = {
  DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
  DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  IOSTORE_EXTRACT_RESULT_PREFIX,
  PAK_EXTRACT_RESULT_PREFIX,
  createExtractWorkerErrorResponse,
  extractIoStoreInWorker,
  extractPakInWorker,
  isExtractResponseLike,
  parseExtractWorkerResult,
  runExtractWorker,
  serializeIoStoreExtractPayload,
  serializePakExtractPayload,
};
