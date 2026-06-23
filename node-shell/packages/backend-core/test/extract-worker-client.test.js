const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_EXTRACT_WORKER_MAX_BUFFER,
  DEFAULT_EXTRACT_WORKER_TIMEOUT_MS,
  PAK_EXTRACT_RESULT_PREFIX,
  IOSTORE_EXTRACT_RESULT_PREFIX,
  runExtractWorker,
  serializePakExtractPayload,
  serializeIoStoreExtractPayload,
  parseExtractWorkerResult,
} = require('../src/extract-worker-client.js');

test('serializePakExtractPayload keeps AES keys in stdin payload only', () => {
  assert.deepEqual(JSON.parse(serializePakExtractPayload({
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  })), {
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  });
});

test('serializeIoStoreExtractPayload keeps AES keys in stdin payload only', () => {
  assert.deepEqual(JSON.parse(serializeIoStoreExtractPayload({
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  })), {
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  });
});

test('runExtractWorker passes payload on stdin and reports worker failures', () => {
  const calls = [];
  const response = runExtractWorker({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    workerPath: 'worker.js',
    nodePath: 'node.exe',
    payload: { dllPath: 'backend.dll', pakPath: 'A.pak', outputDirectory: 'D:\\Out', aesKey: 'secret' },
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 9, signal: null, stdout: '', stderr: '' };
    },
  });

  assert.equal(response.status, 1);
  assert.equal(response.containerPath, 'A.pak');
  assert.equal(response.outputDirectory, 'D:\\Out');
  assert.equal(response.issues[0].code, 'pak.extract_worker_failed');
  assert.equal(calls[0].command, 'node.exe');
  assert.deepEqual(calls[0].args, ['worker.js']);
  assert.doesNotMatch(calls[0].args.join(' '), /secret/);
  assert.equal(calls[0].options.timeout, DEFAULT_EXTRACT_WORKER_TIMEOUT_MS);
  assert.equal(calls[0].options.maxBuffer, DEFAULT_EXTRACT_WORKER_MAX_BUFFER);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(JSON.parse(calls[0].options.input).aesKey, 'secret');
});

test('parseExtractWorkerResult returns decoded payloads and rejects malformed worker output', () => {
  const decoded = { status: 0, issues: [], containerPath: 'A.pak', outputDirectory: 'D:\\Out' };
  assert.deepEqual(parseExtractWorkerResult({
    kind: 'pak',
    resultPrefix: PAK_EXTRACT_RESULT_PREFIX,
    payload: { pakPath: 'A.pak', outputDirectory: 'D:\\Out' },
    stdout: `${PAK_EXTRACT_RESULT_PREFIX}${JSON.stringify({ ok: true, response: decoded })}\n`,
  }), decoded);

  const malformed = parseExtractWorkerResult({
    kind: 'iostore',
    resultPrefix: IOSTORE_EXTRACT_RESULT_PREFIX,
    payload: { utocPath: 'global.utoc', outputDirectory: 'D:\\Out' },
    stdout: '',
  });
  assert.equal(malformed.status, 1);
  assert.equal(malformed.issues[0].code, 'iostore.extract_worker_protocol_error');
});
