const path = require('node:path');

const GET_MODULE_HANDLE_EX_FLAG_PIN = 0x00000001;
const LOAD_LIBRARY_SEARCH_DEFAULT_DIRS = 0x00001000;
const SET_DEFAULT_DLL_DIRECTORIES_SIGNATURE =
  'bool __stdcall SetDefaultDllDirectories(uint32_t DirectoryFlags)';
const ADD_DLL_DIRECTORY_SIGNATURE =
  'void* __stdcall AddDllDirectory(const char16_t *NewDirectory)';
const GET_MODULE_HANDLE_EX_W_SIGNATURE =
  'bool __stdcall GetModuleHandleExW(uint32_t dwFlags, const char16_t *lpModuleName, _Out_ HMODULE *phModule)';
const hmoduleTypeByKoffi = new WeakMap();

function getHModuleType(koffi) {
  let hmoduleType = hmoduleTypeByKoffi.get(koffi);
  if (!hmoduleType) {
    hmoduleType = koffi.pointer('HMODULE', koffi.opaque());
    hmoduleTypeByKoffi.set(koffi, hmoduleType);
  }
  return hmoduleType;
}

function pinBackendDllOnWindows({ dllPath, koffi, platform }) {
  if (platform !== 'win32' || !dllPath) {
    return;
  }

  const kernel32 = koffi.load('kernel32.dll');
  const HMODULE = getHModuleType(koffi);
  const getModuleHandleExW = kernel32.func(GET_MODULE_HANDLE_EX_W_SIGNATURE);
  const outHandle = [null];
  const pinned = getModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN, dllPath, outHandle);
  if (!pinned) {
    throw new Error(`Unable to pin backend DLL with GetModuleHandleExW: ${dllPath}`);
  }

  void HMODULE;
}

function registerBackendDllDirectoryOnWindows({ dllPath, koffi, platform }) {
  if (platform !== 'win32' || !dllPath) {
    return;
  }

  const directory = path.win32.dirname(dllPath);
  const kernel32 = koffi.load('kernel32.dll');
  const setDefaultDllDirectories = kernel32.func(SET_DEFAULT_DLL_DIRECTORIES_SIGNATURE);
  if (!setDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)) {
    throw new Error('Unable to enable Windows DLL directory search defaults.');
  }

  const addDllDirectory = kernel32.func(ADD_DLL_DIRECTORY_SIGNATURE);
  const cookie = addDllDirectory(directory);
  if (!cookie) {
    throw new Error(`Unable to register backend DLL directory: ${directory}`);
  }
}

function loadBackendLibrary({ dllPath, koffi, platform = process.platform }) {
  registerBackendDllDirectoryOnWindows({ dllPath, koffi, platform });
  const library = koffi.load(dllPath);
  pinBackendDllOnWindows({ dllPath, koffi, platform });

  return {
    getBackendInfoV1: library.func('int UPI_GetBackendInfoV1(void*, int, void*)'),
    analyzePakV1: library.func('int UPI_AnalyzePakV1(str, str, void*, int, void*)'),
    analyzeIoStoreV1: library.func('int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)'),
    extractPakV1: library.func('int UPI_ExtractPakV1(str, str, str, void*, int, void*)'),
    extractIoStoreV1: library.func('int UPI_ExtractIoStoreV1(str, str, str, str, void*, int, void*)'),
  };
}

module.exports = { loadBackendLibrary };
