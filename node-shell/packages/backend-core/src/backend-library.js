function loadBackendLibrary({ dllPath, koffi }) {
  const library = koffi.load(dllPath);
  return {
    getBackendInfoV1: library.func('int UPI_GetBackendInfoV1(void*, int, void*)'),
    analyzePakV1: library.func('int UPI_AnalyzePakV1(str, str, void*, int, void*)'),
    analyzeIoStoreV1: library.func('int UPI_AnalyzeIoStoreV1(str, str, str, void*, int, void*)'),
  };
}

module.exports = { loadBackendLibrary };
