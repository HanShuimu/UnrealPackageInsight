const path = require('node:path');

const electron = require('electron');
const koffi = require('koffi');

const { createBackendClient } = require('../../packages/backend-core/src/backend-client.js');
const { resolveDllPath } = require('../../src/dll-paths.js');
const { scanPackageDirectory } = require('../../packages/analysis-domain/src/package-scan.js');
const { AnalysisService } = require('../../packages/analysis-domain/src/analysis-service.js');
const { AesKeySession } = require('../../packages/analysis-domain/src/aes-key-session.js');

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} = typeof electron === 'object' && electron !== null ? electron : {};

const PACKAGE_NOT_OPEN_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'package.not_open',
    message: 'Open a package directory before analyzing files.',
  }],
};

function createValidationErrorResponse(error) {
  return {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'aes.invalid_key',
      message: error.message,
    }],
  };
}

function cloneResponse(response) {
  return {
    status: response.status,
    issues: response.issues.map((issue) => ({ ...issue })),
  };
}

function createDesktopState({ backendClient = null, aesSession = new AesKeySession() } = {}) {
  return {
    aesSession,
    backendClient,
    currentScan: null,
    analysisService: null,
  };
}

function createIpcHandlers({
  state,
  dialog: dialogModule = dialog,
  scanPackageDirectory: scanPackageDirectoryFn = scanPackageDirectory,
  AnalysisService: AnalysisServiceClass = AnalysisService,
} = {}) {
  if (!state) {
    throw new Error('Desktop state is required');
  }

  return {
    getBackendInfo() {
      return state.backendClient.getBackendInfo();
    },

    async openPackageDirectory() {
      const selection = await dialogModule.showOpenDialog({
        properties: ['openDirectory'],
      });

      if (selection.canceled || selection.filePaths.length === 0) {
        return null;
      }

      state.currentScan = await scanPackageDirectoryFn(selection.filePaths[0]);
      state.analysisService = new AnalysisServiceClass({
        backendClient: state.backendClient,
        filePaths: state.currentScan.files.map((file) => file.path),
        aesSession: state.aesSession,
      });

      return state.currentScan;
    },

    async analyze(filePath) {
      if (!state.analysisService) {
        return cloneResponse(PACKAGE_NOT_OPEN_RESPONSE);
      }

      return state.analysisService.analyze(filePath);
    },

    async submitAesKeyAndRetry(filePath, aesKey) {
      if (!state.analysisService) {
        return cloneResponse(PACKAGE_NOT_OPEN_RESPONSE);
      }

      try {
        state.aesSession.setKey(aesKey);
      } catch (error) {
        state.aesSession.clear();
        return createValidationErrorResponse(error);
      }

      return state.analysisService.analyze(filePath);
    },

    async clearAesKey() {
      state.aesSession.clear();
      return true;
    },
  };
}

function registerIpcHandlers(ipcMainModule, handlers) {
  ipcMainModule.handle('backend:getInfo', () => handlers.getBackendInfo());
  ipcMainModule.handle('package:openDirectory', () => handlers.openPackageDirectory());
  ipcMainModule.handle('analysis:analyze', (_event, filePath) => handlers.analyze(filePath));
  ipcMainModule.handle('analysis:submitAesKeyAndRetry', (_event, filePath, aesKey) => (
    handlers.submitAesKeyAndRetry(filePath, aesKey)
  ));
  ipcMainModule.handle('analysis:clearAesKey', () => handlers.clearAesKey());
}

const desktopState = createDesktopState();

function createWindow({ BrowserWindowClass = BrowserWindow } = {}) {
  const window = new BrowserWindowClass({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return window;
}

function initializeBackendClient({
  state = desktopState,
  env = process.env,
  koffiModule = koffi,
  backendClientFactory = createBackendClient,
} = {}) {
  const dllPath = resolveDllPath(env.UPI_BACKEND_DLL);
  state.backendClient = backendClientFactory({ dllPath, koffi: koffiModule });
  return state.backendClient;
}

function startDesktopApp() {
  const handlers = createIpcHandlers({ state: desktopState });
  registerIpcHandlers(ipcMain, handlers);

  app.whenReady().then(() => {
    initializeBackendClient();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

if (app && BrowserWindow && dialog && ipcMain) {
  startDesktopApp();
}

module.exports = {
  PACKAGE_NOT_OPEN_RESPONSE,
  createDesktopState,
  createIpcHandlers,
  registerIpcHandlers,
  createWindow,
  initializeBackendClient,
};
