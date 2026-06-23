const assert = require('node:assert/strict');
const test = require('node:test');

const { loadBackendLibrary } = require('../src/backend-library.js');

test('loadBackendLibrary registers the expected V1 export signatures', () => {
  const signatures = [];
  const exports = {
    'int UPI_GetBackendInfoV1(void*, int, void*)': () => {},
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)': () => {},
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)': () => {},
    'int UPI_ExtractPakV1(str, str, str, void*, int, void*)': () => {},
    'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)': () => {},
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

  const library = loadBackendLibrary({ dllPath: 'backend.dll', koffi, platform: 'linux' });

  assert.deepEqual(signatures, [
    'int UPI_GetBackendInfoV1(void*, int, void*)',
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)',
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)',
    'int UPI_ExtractPakV1(str, str, str, void*, int, void*)',
    'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)',
  ]);
  assert.equal(library.getBackendInfoV1, exports['int UPI_GetBackendInfoV1(void*, int, void*)']);
  assert.equal(library.analyzePakV1, exports['int UPI_AnalyzePakV1(str, str, void*, int, void*)']);
  assert.equal(
    library.analyzeIoStoreV1,
    exports['int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)']
  );
  assert.equal(library.extractPakV1, exports['int UPI_ExtractPakV1(str, str, str, void*, int, void*)']);
  assert.equal(
    library.extractIoStoreV1,
    exports['int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)']
  );
});

test('loadBackendLibrary pins the backend DLL on Windows before registering exports', () => {
  const events = [];
  const exports = {
    'int UPI_GetBackendInfoV1(void*, int, void*)': () => {},
    'int UPI_AnalyzePakV1(str, str, void*, int, void*)': () => {},
    'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)': () => {},
    'int UPI_ExtractPakV1(str, str, str, void*, int, void*)': () => {},
    'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)': () => {},
  };
  const koffi = {
    load(dllPath) {
      events.push(['load', dllPath]);
      if (dllPath === 'kernel32.dll') {
        return {
          func(signature) {
            events.push(['kernel-func', signature]);
            if (signature === 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)') {
              return (flags) => {
                events.push(['set-default-dll-directories', flags]);
                return true;
              };
            }
            if (signature === 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)') {
              return (directory) => {
                events.push(['add-dll-directory', directory]);
                return 'directory-cookie';
              };
            }
            return (flags, moduleName, outHandle) => {
              events.push(['pin', flags, moduleName, Array.isArray(outHandle)]);
              outHandle[0] = 'backend-hmodule';
              return true;
            };
          },
        };
      }

      assert.equal(dllPath, 'backend.dll');
      return {
        func(signature) {
          events.push(['backend-func', signature]);
          return exports[signature];
        },
      };
    },
    opaque() {
      events.push(['opaque']);
      return 'opaque';
    },
    pointer(name, type) {
      events.push(['pointer', name, type]);
      return 'hmodule-pointer';
    },
  };

  loadBackendLibrary({ dllPath: 'backend.dll', koffi, platform: 'win32' });

  assert.deepEqual(events, [
    ['load', 'kernel32.dll'],
    ['kernel-func', 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)'],
    ['set-default-dll-directories', 4096],
    ['kernel-func', 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)'],
    ['add-dll-directory', '.'],
    ['load', 'backend.dll'],
    ['load', 'kernel32.dll'],
    ['opaque'],
    ['pointer', 'HMODULE', 'opaque'],
    [
      'kernel-func',
      'bool __stdcall GetModuleHandleExW(uint32_t dwFlags, const char16_t *lpModuleName, _Out_ HMODULE *phModule)',
    ],
    ['pin', 1, 'backend.dll', true],
    ['backend-func', 'int UPI_GetBackendInfoV1(void*, int, void*)'],
    ['backend-func', 'int UPI_AnalyzePakV1(str, str, void*, int, void*)'],
    ['backend-func', 'int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)'],
    ['backend-func', 'int UPI_ExtractPakV1(str, str, str, void*, int, void*)'],
    ['backend-func', 'int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)'],
  ]);
});

test('loadBackendLibrary reuses the Windows HMODULE type across repeated loads', () => {
  const events = [];
  let hmoduleRegistered = false;
  const koffi = {
    load(dllPath) {
      events.push(['load', dllPath]);
      if (dllPath === 'kernel32.dll') {
        return {
          func(signature) {
            events.push(['kernel-func', signature]);
            if (signature === 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)') {
              return () => true;
            }
            if (signature === 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)') {
              return () => 'directory-cookie';
            }
            return (flags, moduleName, outHandle) => {
              events.push(['pin', flags, moduleName, Array.isArray(outHandle)]);
              outHandle[0] = `pinned:${moduleName}`;
              return true;
            };
          },
        };
      }

      return {
        func(signature) {
          events.push(['backend-func', dllPath, signature]);
          return () => {};
        },
      };
    },
    opaque() {
      events.push(['opaque']);
      return 'opaque';
    },
    pointer(name, type) {
      events.push(['pointer', name, type]);
      if (name === 'HMODULE' && hmoduleRegistered) {
        throw new Error("Duplicate type name 'HMODULE'");
      }
      hmoduleRegistered = true;
      return 'hmodule-pointer';
    },
  };

  loadBackendLibrary({ dllPath: 'debug-backend.dll', koffi, platform: 'win32' });
  loadBackendLibrary({ dllPath: 'development-backend.dll', koffi, platform: 'win32' });

  assert.deepEqual(
    events.filter((event) => event[0] === 'pointer'),
    [['pointer', 'HMODULE', 'opaque']],
  );
  assert.deepEqual(
    events.filter((event) => event[0] === 'pin').map((event) => event[2]),
    ['debug-backend.dll', 'development-backend.dll'],
  );
});

test('loadBackendLibrary throws when Windows DLL pinning fails', () => {
  const events = [];
  const koffi = {
    load(dllPath) {
      events.push(['load', dllPath]);
      if (dllPath === 'kernel32.dll') {
        return {
          func(signature) {
            events.push(['kernel-func', signature]);
            if (signature === 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)') {
              return () => true;
            }
            if (signature === 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)') {
              return () => 'directory-cookie';
            }
            return () => {
              events.push(['pin']);
              return false;
            };
          },
        };
      }

      return {
        func(signature) {
          events.push(['backend-func', signature]);
          return () => {};
        },
      };
    },
    opaque() {
      return 'opaque';
    },
    pointer() {
      return 'hmodule-pointer';
    },
  };

  assert.throws(
    () => loadBackendLibrary({ dllPath: 'backend.dll', koffi, platform: 'win32' }),
    /Unable to pin backend DLL.*backend\.dll/
  );
  assert.deepEqual(events, [
    ['load', 'kernel32.dll'],
    ['kernel-func', 'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)'],
    ['kernel-func', 'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)'],
    ['load', 'backend.dll'],
    ['load', 'kernel32.dll'],
    [
      'kernel-func',
      'bool __stdcall GetModuleHandleExW(uint32_t dwFlags, const char16_t *lpModuleName, _Out_ HMODULE *phModule)',
    ],
    ['pin'],
  ]);
});

test('loadBackendLibrary skips Windows DLL pinning on non-Windows platforms', () => {
  const loaded = [];
  const koffi = {
    load(dllPath) {
      loaded.push(dllPath);
      return {
        func() {
          return () => {};
        },
      };
    },
  };

  loadBackendLibrary({ dllPath: 'backend.dll', koffi, platform: 'linux' });

  assert.deepEqual(loaded, ['backend.dll']);
});
