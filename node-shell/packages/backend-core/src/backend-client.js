const { decodeBackendInfoResponse } = require('../../protocol/src/backend-info-decoder.js');
const { loadBackendLibrary } = require('./backend-library.js');
const { callBufferedExport } = require('./call-buffered-export.js');
const { analyzeIoStoreInWorker } = require('./iostore-analysis-worker-client.js');
const { analyzePakInWorker } = require('./pak-analysis-worker-client.js');

function createBackendClient({
  dllPath,
  koffi,
  platform = process.platform,
  runIoStoreAnalysisWorker = analyzeIoStoreInWorker,
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
      return runIoStoreAnalysisWorker({
        dllPath,
        utocPath,
        ucasPath,
        aesKey: aesKey ?? '',
      });
    },
  };
}

module.exports = { createBackendClient };
