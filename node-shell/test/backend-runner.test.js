const assert = require('node:assert/strict');
const test = require('node:test');

const { runBackendSmoke } = require('../src/backend-runner');

function createFakeKoffi() {
  const calls = [];
  const fakeLibrary = {
    func(signature) {
      calls.push(signature);
      if (signature === 'str UPI_GetBackendInfo()') {
        return () => 'UnrealPackageInsightBackend/0.1 UE-DLL-Spike';
      }
      if (signature === 'int UPI_Add(int, int)') {
        return (a, b) => a + b;
      }
      throw new Error(`Unexpected signature: ${signature}`);
    },
  };

  return {
    calls,
    load(dllPath) {
      calls.push(`load:${dllPath}`);
      return fakeLibrary;
    },
  };
}

test('runBackendSmoke loads the DLL and calls exported functions', () => {
  const fakeKoffi = createFakeKoffi();
  const output = [];

  const result = runBackendSmoke({
    dllPath: 'C:\\backend\\UnrealPackageInsightBackend.dll',
    koffi: fakeKoffi,
    log: (line) => output.push(line),
  });

  assert.deepEqual(fakeKoffi.calls, [
    'load:C:\\backend\\UnrealPackageInsightBackend.dll',
    'str UPI_GetBackendInfo()',
    'int UPI_Add(int, int)',
  ]);
  assert.deepEqual(output, [
    'Backend info: UnrealPackageInsightBackend/0.1 UE-DLL-Spike',
    'UPI_Add(20, 22): 42',
  ]);
  assert.equal(result.backendInfo, 'UnrealPackageInsightBackend/0.1 UE-DLL-Spike');
  assert.equal(result.addResult, 42);
});
