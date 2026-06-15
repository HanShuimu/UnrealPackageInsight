const { createBackendClient } = require('../packages/backend-core/src/backend-client.js');

function runBackendSmoke({ dllPath, koffi, log = console.log }) {
  const client = createBackendClient({ dllPath, koffi });
  const backendInfo = client.getBackendInfo();

  log(`Backend: ${backendInfo.backendName} ${backendInfo.backendVersion}`);
  log(`Unreal: ${backendInfo.unrealVersion}`);
  log(`Protocol: ${backendInfo.protocolVersion}`);

  return {
    backendInfo,
  };
}

module.exports = {
  runBackendSmoke,
};
