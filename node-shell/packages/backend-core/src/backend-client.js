const { decodeBackendInfoResponse } = require('../../protocol/src/backend-info-decoder.js');
const { decodeIoStoreAnalysisResponse } = require('../../protocol/src/iostore-analysis-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { analyzePakInWorker } = require('./pak-analysis-worker-client.js');

function createBackendClient({
  dllPath,
  koffi,
  platform = process.platform,
  runPakAnalysisWorker = analyzePakInWorker,
}) {
  const library = loadBackendLibrary({ dllPath, koffi, platform });

  return {
    getBackendInfo() {
      const bytes = callBufferedExport({
        fn: library.getBackendInfoV1,
        koffi,
      });
      return decodeBackendInfoResponse(bytes);
    },

    analyzePak({ pakPath, aesKey = '' }) {
      return runPakAnalysisWorker({
        dllPath,
        pakPath,
        aesKey: aesKey ?? '',
      });
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
