const GET_MODULE_HANDLE_EX_FLAG_PIN = 0x00000001;
const GET_MODULE_HANDLE_EX_W_SIGNATURE =
  'bool __stdcall GetModuleHandleExW(uint32_t dwFlags, const char16_t *lpModuleName, _Out_ HMODULE *phModule)';

function pinBackendDllOnWindows({ dllPath, koffi, platform }) {
  if (platform !== 'win32' || !dllPath) {
    return;
  }

  const kernel32 = koffi.load('kernel32.dll');
  const HMODULE = koffi.pointer('HMODULE', koffi.opaque());
  const getModuleHandleExW = kernel32.func(GET_MODULE_HANDLE_EX_W_SIGNATURE);
  const outHandle = [null];
  const pinned = getModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN, dllPath, outHandle);
  if (!pinned) {
    throw new Error(`Unable to pin backend DLL with GetModuleHandleExW: ${dllPath}`);
  }

  void HMODULE;
}

function loadBackendLibrary({ dllPath, koffi, platform = process.platform }) {
  const library = koffi.load(dllPath);
  pinBackendDllOnWindows({ dllPath, koffi, platform });

  return {
    getBackendInfoV1: library.func('int UPI_GetBackendInfoV1(void*, int, void*)'),
    analyzePakV1: library.func('int UPI_AnalyzePakV1(str, str, void*, int, void*)'),
    analyzeIoStoreV1: library.func('int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)'),
  };
}

module.exports = { loadBackendLibrary };
