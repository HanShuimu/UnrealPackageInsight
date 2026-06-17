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

  submitAesKeyAndRetry(filePath, aesKey) {
    return ipcRenderer.invoke('analysis:submitAesKeyAndRetry', filePath, aesKey);
  },

  clearAesKey() {
    return ipcRenderer.invoke('analysis:clearAesKey');
  },
});
