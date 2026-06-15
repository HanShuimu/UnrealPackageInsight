const { decodeBackendInfoResponse } = require('../../protocol/src/backend-info-decoder.js');
const { decodeIoStoreAnalysisResponse } = require('../../protocol/src/iostore-analysis-decoder.js');
const { decodePakAnalysisResponse } = require('../../protocol/src/pak-analysis-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');

function createBackendClient({ dllPath, koffi }) {
  const library = loadBackendLibrary({ dllPath, koffi });

  return {
    getBackendInfo() {
      const bytes = callBufferedExport({
        fn: library.getBackendInfoV1,
        koffi,
      });
      return decodeBackendInfoResponse(bytes);
    },

    analyzePak({ pakPath, aesKey = '' }) {
      const bytes = callBufferedExport({
        fn: library.analyzePakV1,
        koffi,
        args: [pakPath, aesKey ?? ''],
      });
      return decodePakAnalysisResponse(bytes);
    },

    analyzeIoStore({ utocPath, ucasPath, aesKey = '' }) {
      const bytes = callBufferedExport({
        fn: library.analyzeIoStoreV1,
        koffi,
        args: [utocPath, ucasPath, aesKey ?? ''],
      });
      return decodeIoStoreAnalysisResponse(bytes);
    },
  };
}

module.exports = { createBackendClient };
