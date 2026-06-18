const assert = require('node:assert/strict');
const test = require('node:test');

const flatbuffers = require('flatbuffers');

const {
  BackendInfoResponse,
  ResponseStatus,
} = require('../packages/protocol/generated/js/upi/v1.js');
const { runBackendSmoke } = require('../src/backend-runner');

function createBackendInfoBuffer() {
  const builder = new flatbuffers.Builder(256);
  const backendName = builder.createString('UnrealPackageInsightBackend');
  const backendVersion = builder.createString('0.2.0');
  const unrealVersion = builder.createString('5.x');
  const root = BackendInfoResponse.createBackendInfoResponse(
    builder,
    1,
    ResponseStatus.Ok,
    0,
    backendName,
    backendVersion,
    unrealVersion,
    1,
  );
  BackendInfoResponse.finishBackendInfoResponseBuffer(builder, root);
  return Buffer.from(builder.asUint8Array());
}

function createFakeKoffi() {
  const calls = [];
  const backendInfoBuffer = createBackendInfoBuffer();
  const fakeLibrary = {
    func(signature) {
      calls.push(signature);
      if (signature === 'int UPI_GetBackendInfoV1(void*, int, void*)') {
        return (output, capacity, requiredSize) => {
          requiredSize[0] = backendInfoBuffer.length;
          if (capacity < backendInfoBuffer.length) {
            return 1;
          }

          backendInfoBuffer.copy(output);
          return 0;
        };
      }
      if (signature === 'int UPI_AnalyzePakV1(str, str, void*, int, void*)') {
        return () => {
          throw new Error('Unexpected Pak analysis call');
        };
      }
      if (signature === 'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)') {
        return () => {
          throw new Error('Unexpected IoStore analysis call');
        };
      }
      throw new Error(`Unexpected signature: ${signature}`);
    },
  };

  return {
    calls,
    load(dllPath) {
      calls.push(`load:${dllPath}`);
      if (dllPath === 'kernel32.dll') {
        return {
          func(signature) {
            calls.push(signature);
            if (signature === 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)') {
              return (flags) => {
                calls.push(`set-default-dll-directories:${flags}`);
                return true;
              };
            }
            if (signature === 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)') {
              return (directory) => {
                calls.push(`add-dll-directory:${directory}`);
                return 'directory-cookie';
              };
            }
            return (flags, moduleName, outHandle) => {
              calls.push(`pin:${flags}:${moduleName}`);
              outHandle[0] = 'backend-hmodule';
              return true;
            };
          },
        };
      }

      return fakeLibrary;
    },
    opaque() {
      calls.push('opaque');
      return 'opaque';
    },
    pointer(name, type) {
      calls.push(`pointer:${name}:${type}`);
      return 'hmodule-pointer';
    },
  };
}

test('runBackendSmoke loads the DLL and prints V1 backend info', () => {
  const fakeKoffi = createFakeKoffi();
  const output = [];

  const result = runBackendSmoke({
    dllPath: 'C:\\backend\\UnrealPackageInsightBackend.dll',
    koffi: fakeKoffi,
    log: (line) => output.push(line),
  });

  assert.deepEqual(fakeKoffi.calls, [
    'load:kernel32.dll',
    'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)',
    'set-default-dll-directories:4096',
    'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)',
    'add-dll-directory:C:\\backend',
    'load:C:\\backend\\UnrealPackageInsightBackend.dll',
    'load:kernel32.dll',
    'opaque',
    'pointer:HMODULE:opaque',
    'bool __stdcall GetModuleHandleExW(uint32_t dwFlags, const char16_t *lpModuleName, _Out_ HMODULE *phModule)',
    'pin:1:C:\\backend\\UnrealPackageInsightBackend.dll',
    'int UPI_GetBackendInfoV1(void*, int, void*)',
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)',
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)',
  ]);
  assert.deepEqual(output, [
    'Backend: UnrealPackageInsightBackend 0.2.0',
    'Unreal: 5.x',
    'Protocol: 1',
  ]);
  assert.deepEqual(result.backendInfo, {
    schemaVersion: 1,
    status: ResponseStatus.Ok,
    issues: [],
    backendName: 'UnrealPackageInsightBackend',
    backendVersion: '0.2.0',
    unrealVersion: '5.x',
    protocolVersion: 1,
  });
});
