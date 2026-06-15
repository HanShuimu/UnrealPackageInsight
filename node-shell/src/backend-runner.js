function runBackendSmoke({ dllPath, koffi, log = console.log }) {
  const library = koffi.load(dllPath);
  const getBackendInfo = library.func('str UPI_GetBackendInfo()');
  const add = library.func('int UPI_Add(int, int)');

  const backendInfo = getBackendInfo();
  const addResult = add(20, 22);

  log(`Backend info: ${backendInfo}`);
  log(`UPI_Add(20, 22): ${addResult}`);

  return {
    backendInfo,
    addResult,
  };
}

module.exports = {
  runBackendSmoke,
};
