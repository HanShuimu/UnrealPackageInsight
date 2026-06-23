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

          if (signature === 'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)') {
            return () => {
              throw new Error('Parent process must not run IoStore analysis in-process');
            };
          }

          if (signature === 'int UPI_ExtractPakV1(str, str, str, void*, int, void*)') {
            return () => {
              throw new Error('Parent process must not run Pak extraction in-process');
            };
          }

          if (signature === 'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)') {
            return () => {
              throw new Error('Parent process must not run IoStore extraction in-process');
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

test('createBackendClient delegates IoStore analysis to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 1,
    issues: [{ code: 'iostore.worker_failed' }],
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runIoStoreAnalysisWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.analyzeIoStore({
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    aesKey: 'abc123',
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    aesKey: 'abc123',
  }]);
});

test('createBackendClient delegates Pak extraction to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 0,
    issues: [],
    containerPath: 'A.pak',
    outputDirectory: 'D:\\Out',
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runPakExtractWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.extractPak({
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    pakPath: 'A.pak',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  }]);
});

test('createBackendClient delegates IoStore extraction to the worker process', () => {
  const workerCalls = [];
  const expectedResponse = {
    status: 0,
    issues: [],
    containerPath: 'global.utoc',
    outputDirectory: 'D:\\Out',
  };
  const client = createBackendClient({
    dllPath: 'backend.dll',
    koffi: createFakeKoffi(),
    platform: 'linux',
    runIoStoreExtractWorker(request) {
      workerCalls.push(request);
      return expectedResponse;
    },
  });

  const response = client.extractIoStore({
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  });

  assert.equal(response, expectedResponse);
  assert.deepEqual(workerCalls, [{
    dllPath: 'backend.dll',
    utocPath: 'global.utoc',
    ucasPath: 'global.ucas',
    outputDirectory: 'D:\\Out',
    aesKey: 'abc123',
  }]);
});
