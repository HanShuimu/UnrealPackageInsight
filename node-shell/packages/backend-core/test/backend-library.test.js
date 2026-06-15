const assert = require('node:assert/strict');
const test = require('node:test');

const { loadBackendLibrary } = require('../src/backend-library.js');

test('loadBackendLibrary registers the expected V1 export signatures', () => {
  const signatures = [];
  const exports = {
    'int UPI_GetBackendInfoV1(void*, int, void*)': () => {},
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)': () => {},
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)': () => {},
  };
  const koffi = {
    load(dllPath) {
      assert.equal(dllPath, 'backend.dll');
      return {
        func(signature) {
          signatures.push(signature);
          return exports[signature];
        },
      };
    },
  };

  const library = loadBackendLibrary({ dllPath: 'backend.dll', koffi });

  assert.deepEqual(signatures, [
    'int UPI_GetBackendInfoV1(void*, int, void*)',
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)',
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)',
  ]);
  assert.equal(library.getBackendInfoV1, exports['int UPI_GetBackendInfoV1(void*, int, void*)']);
  assert.equal(library.analyzePakV1, exports['int UPI_AnalyzePakV1(str, str, void*, int, void*)']);
  assert.equal(
    library.analyzeIoStoreV1,
    exports['int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)']
  );
});
