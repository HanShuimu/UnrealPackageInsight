const assert = require('node:assert/strict');
const test = require('node:test');

const { createBackendClient } = require('../src/backend-client.js');

function createFakeKoffi() {
  return {
    load() {
      return {
        func(signature) {
          if (signature === 'int UPI_AnalyzePakV1(str, str, void*, int, void*)') {
            return () => {
              throw new Error('Parent process must not run Pak analysis in-process');
            };
          }

          return () => {};
        },
      };
    },
  };
}

test('createBackendClient delegates Pak analysis to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 1,
    issues: [{ code: 'pak.worker_failed' }],
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runPakAnalysisWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.analyzePak({ pakPath: 'corrupt.pak', aesKey: 'abc123' });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    pakPath: 'corrupt.pak',
    aesKey: 'abc123',
  }]);
});
