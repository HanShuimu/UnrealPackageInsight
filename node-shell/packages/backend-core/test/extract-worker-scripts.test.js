const assert = require('node:assert/strict');
const test = require('node:test');

const {
  IOSTORE_EXTRACT_RESULT_PREFIX,
  PAK_EXTRACT_RESULT_PREFIX,
} = require('../src/extract-worker-client.js');
const pakWorker = require('../src/pak-extract-worker.js');
const ioStoreWorker = require('../src/iostore-extract-worker.js');

test('pak extract worker main decodes payload and writes a prefixed decoded result', () => {
  const calls = [];
  const fakeKoffi = { name: 'fake-koffi' };
  const extractPakV1 = () => {};
  const bytes = Buffer.from([1, 2, 3]);
  const decoded = {
    schemaVersion: 1,
    status: 0,
    issues: [],
    containerPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    extractedFileCount: 3,
    errorCount: 0,
  };
  let output = '';

  pakWorker.main(JSON.stringify({
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  }), {
    koffi: fakeKoffi,
    loadBackendLibrary({ dllPath, koffi }) {
      calls.push(['loadBackendLibrary', dllPath, koffi]);
      return { extractPakV1 };
    },
    callBufferedExport({ fn, koffi, args }) {
      calls.push(['callBufferedExport', fn, koffi, args]);
      return bytes;
    },
    decodeExtractResponse(actualBytes) {
      calls.push(['decodeExtractResponse', actualBytes]);
      return decoded;
    },
    write(chunk) {
      output += chunk;
    },
  });

  assert.deepEqual(calls, [
    ['loadBackendLibrary', 'backend.dll', fakeKoffi],
    ['callBufferedExport', extractPakV1, fakeKoffi, ['A.pak', 'D:\\Out', 'secret']],
    ['decodeExtractResponse', bytes],
  ]);
  assert.equal(output, `${PAK_EXTRACT_RESULT_PREFIX}${JSON.stringify({ ok: true, response: decoded })}\n`);
});

test('iostore extract worker main decodes payload and writes a prefixed decoded result', () => {
  const calls = [];
  const fakeKoffi = { name: 'fake-koffi' };
  const extractIoStoreV1 = () => {};
  const bytes = Buffer.from([4, 5, 6]);
  const decoded = {
    schemaVersion: 1,
    status: 0,
    issues: [],
    containerPath: 'global.utoc',
    outputDirectory: 'D:\\Out',
    extractedFileCount: 4,
    errorCount: 0,
  };
  let output = '';

  ioStoreWorker.main(JSON.stringify({
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'secret',
  }), {
    koffi: fakeKoffi,
    loadBackendLibrary({ dllPath, koffi }) {
      calls.push(['loadBackendLibrary', dllPath, koffi]);
      return { extractIoStoreV1 };
    },
    callBufferedExport({ fn, koffi, args }) {
      calls.push(['callBufferedExport', fn, koffi, args]);
      return bytes;
    },
    decodeExtractResponse(actualBytes) {
      calls.push(['decodeExtractResponse', actualBytes]);
      return decoded;
    },
    write(chunk) {
      output += chunk;
    },
  });

  assert.deepEqual(calls, [
    ['loadBackendLibrary', 'backend.dll', fakeKoffi],
    ['callBufferedExport', extractIoStoreV1, fakeKoffi, ['global.utoc', 'global.ucas', 'D:\\Out', 'secret']],
    ['decodeExtractResponse', bytes],
  ]);
  assert.equal(output, `${IOSTORE_EXTRACT_RESULT_PREFIX}${JSON.stringify({ ok: true, response: decoded })}\n`);
});
