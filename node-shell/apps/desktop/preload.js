const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('upi', {
  getBackendInfo() {
    return ipcRenderer.invoke('backend:getInfo');
  },

  openPackageDirectory() {
    return ipcRenderer.invoke('package:openDirectory');
  },

  analyze(filePath) {
    return ipcRenderer.invoke('analysis:analyze', filePath);
  },

  extractSelectedContainer(filePath) {
    return ipcRenderer.invoke('analysis:extractSelectedContainer', filePath);
  },

  choosePackagesCsvSavePath(filePath) {
    return ipcRenderer.invoke('packagesCsv:chooseSavePath', filePath);
  },

  writePackagesCsv(filePath, csvText) {
    return ipcRenderer.invoke('packagesCsv:write', filePath, csvText);
  },

  submitAesKeyAndRetry(filePath, aesKey) {
    return ipcRenderer.invoke('analysis:submitAesKeyAndRetry', filePath, aesKey);
  },

  clearAesKey() {
    return ipcRenderer.invoke('analysis:clearAesKey');
  },

  chooseBackend(request) {
    return ipcRenderer.invoke('backend:choose', request);
  },

  requestBackendSelection(filePath) {
    return ipcRenderer.invoke('backend:requestSelection', filePath);
  },
});
