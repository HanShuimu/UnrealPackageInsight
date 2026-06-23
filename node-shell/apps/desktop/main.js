const path = require('node:path');

const electron = require('electron');
const koffi = require('koffi');

const {
  loadBackendManifests,
  summarizeBackends,
} = require('../../packages/backend-core/src/backend-registry.js');
const { createBackendClientProvider } = require('../../packages/backend-core/src/backend-client-provider.js');
const { scanPackageDirectory } = require('../../packages/analysis-domain/src/package-scan.js');
const { AnalysisService } = require('../../packages/analysis-domain/src/analysis-service.js');
const { AesKeySession } = require('../../packages/analysis-domain/src/aes-key-session.js');
const { probeContainerFile } = require('../../packages/analysis-domain/src/container-probe.js');

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
} = typeof electron === 'object' && electron !== null ? electron : {};

const SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG = '--upi-smoke-disable-hardware-acceleration';

if (app && process.argv.includes(SMOKE_DISABLE_HARDWARE_ACCELERATION_ARG)) {
  app.disableHardwareAcceleration();
}

const PACKAGE_NOT_OPEN_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'package.not_open',
    message: 'Open a package directory before analyzing files.',
  }],
};

const PACKAGE_NOT_OPEN_EXTRACT_RESPONSE = {
  status: 'Error',
  issues: [{
    severity: 'error',
    code: 'package.not_open',
    message: 'Open a package directory before extracting files.',
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

function hasBackendAesRejection(response) {
  return Boolean(response?.issues?.some((issue) => {
    const code = String(issue?.code || '');
    return code.endsWith('.aes_key_invalid') || code.endsWith('.aes_key_required');
  }));
}

function createDesktopState({
  backendClientProvider = null,
  backendRegistrySummary = { status: 'OK', backendCount: 0, backends: [] },
  backendSelections = new Map(),
  pendingBackendSelections = new Map(),
  aesSession = new AesKeySession(),
} = {}) {
  return {
    aesSession,
    backendSelections,
    pendingBackendSelections,
    backendClientProvider,
    backendRegistrySummary,
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
      return state.backendRegistrySummary;
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
        backendClientProvider: state.backendClientProvider,
        filePaths: state.currentScan.files.map((file) => file.path),
        aesSession: state.aesSession,
      });

      return state.currentScan;
    },

    async analyze(filePath) {
      if (!state.analysisService) {
        return cloneResponse(PACKAGE_NOT_OPEN_RESPONSE);
      }

      let result;
      try {
        result = await state.analysisService.analyze(filePath);
      } catch (error) {
        if (error.code === 'backend.multiple_candidates') {
          const candidates = Array.isArray(error.candidates) ? error.candidates : [];
          state.pendingBackendSelections.set(error.filePath, {
            candidates,
            candidateIds: new Set(candidates.map((candidate) => candidate.id)),
          });
          return {
            status: 'Error',
            issues: [{
              severity: 'error',
              code: 'backend.multiple_candidates',
              message: error.message,
            }],
            backendSelection: {
              filePath: error.filePath,
              probe: error.probe,
              candidates: error.candidates,
            },
          };
        }
        if (error.code === 'backend.no_compatible_backend') {
          return {
            status: 'Error',
            issues: [{
              severity: 'error',
              code: 'backend.no_compatible_backend',
              message: error.message,
            }],
          };
        }
        throw error;
      }
      if (hasBackendAesRejection(result)) {
        state.aesSession.clear();
      }
      return result;
    },

    async extractSelectedContainer(filePath) {
      if (!state.analysisService) {
        return cloneResponse(PACKAGE_NOT_OPEN_EXTRACT_RESPONSE);
      }

      const selection = await dialogModule.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Extract to...',
      });

      if (selection.canceled || selection.filePaths.length === 0) {
        return null;
      }

      return state.analysisService.extract(filePath, selection.filePaths[0]);
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

      const result = await state.analysisService.analyze(filePath);
      if (hasBackendAesRejection(result)) {
        state.aesSession.clear();
      }
      return result;
    },

    async clearAesKey() {
      state.aesSession.clear();
      return true;
    },

    chooseBackend(request) {
      const selectedId = request?.selectedId || '';
      const filePath = request?.filePath || '';
      if (!filePath) {
        return '';
      }
      if (!selectedId) {
        state.pendingBackendSelections.delete(filePath);
        return '';
      }
      const pending = state.pendingBackendSelections.get(filePath);
      const candidateIds = pending?.candidateIds || new Set((pending?.candidates || []).map((candidate) => candidate.id));
      if (!pending || !candidateIds.has(selectedId)) {
        return '';
      }
      state.backendSelections.set(filePath, selectedId);
      if (state.backendClientProvider && typeof state.backendClientProvider.setSelection === 'function') {
        state.backendClientProvider.setSelection(filePath, selectedId);
      }
      state.pendingBackendSelections.delete(filePath);
      return selectedId;
    },

    requestBackendSelection(filePath) {
      if (!filePath || !state.analysisService || typeof state.analysisService.getBackendSelection !== 'function') {
        return null;
      }

      const selection = state.analysisService.getBackendSelection(filePath);
      const candidates = Array.isArray(selection?.candidates) ? selection.candidates : [];
      if (!selection || candidates.length === 0 || !selection.filePath) {
        return selection || null;
      }

      state.pendingBackendSelections.set(selection.filePath, {
        candidates,
        candidateIds: new Set(candidates.map((candidate) => candidate.id)),
      });
      return selection;
    },
  };
}

function registerIpcHandlers(ipcMainModule, handlers) {
  ipcMainModule.handle('backend:getInfo', () => handlers.getBackendInfo());
  ipcMainModule.handle('package:openDirectory', () => handlers.openPackageDirectory());
  ipcMainModule.handle('analysis:analyze', (_event, filePath) => handlers.analyze(filePath));
  ipcMainModule.handle('analysis:extractSelectedContainer', (_event, filePath) => (
    handlers.extractSelectedContainer(filePath)
  ));
  ipcMainModule.handle('analysis:submitAesKeyAndRetry', (_event, filePath, aesKey) => (
    handlers.submitAesKeyAndRetry(filePath, aesKey)
  ));
  ipcMainModule.handle('analysis:clearAesKey', () => handlers.clearAesKey());
  ipcMainModule.handle('backend:choose', (_event, request) => handlers.chooseBackend(request));
  ipcMainModule.handle('backend:requestSelection', (_event, filePath) => handlers.requestBackendSelection(filePath));
}

const desktopState = createDesktopState();

async function createWindow({ BrowserWindowClass = BrowserWindow } = {}) {
  const window = new BrowserWindowClass({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'));
  return window;
}

function initializeBackendRouting({
  state = desktopState,
  koffiModule = koffi,
  loadBackendManifestsFn = loadBackendManifests,
  probeContainerFileFn = probeContainerFile,
  summarizeBackendsFn = summarizeBackends,
  providerFactory = createBackendClientProvider,
} = {}) {
  const manifests = loadBackendManifestsFn();
  state.backendRegistrySummary = summarizeBackendsFn(manifests);
  state.backendClientProvider = providerFactory({
    manifests,
    koffi: koffiModule,
    probeContainerFile: probeContainerFileFn,
    selectionStore: state.backendSelections,
  });
  return state.backendClientProvider;
}

function showStartupErrorAndQuit({ app: appModule, dialog: dialogModule, error }) {
  try {
    if (dialogModule && typeof dialogModule.showErrorBox === 'function') {
      dialogModule.showErrorBox(
        'UnrealPackageInsight failed to start',
        error?.message || String(error),
      );
    }
  } finally {
    appModule.quit();
  }
}

function startDesktopApp({
  app: appModule = app,
  BrowserWindowClass = BrowserWindow,
  dialog: dialogModule = dialog,
  ipcMain: ipcMainModule = ipcMain,
  state = desktopState,
  initializeBackendRouting: initializeBackendRoutingFn = initializeBackendRouting,
  createWindow: createWindowFn = createWindow,
} = {}) {
  const handlers = createIpcHandlers({ state, dialog: dialogModule });
  registerIpcHandlers(ipcMainModule, handlers);

  const startup = appModule.whenReady().then(async () => {
    initializeBackendRoutingFn({ state });
    await createWindowFn({ BrowserWindowClass });

    appModule.on('activate', () => {
      if (BrowserWindowClass.getAllWindows().length === 0) {
        createWindowFn({ BrowserWindowClass }).catch((error) => {
          showStartupErrorAndQuit({ app: appModule, dialog: dialogModule, error });
        });
      }
    });
  }).catch((error) => {
    showStartupErrorAndQuit({ app: appModule, dialog: dialogModule, error });
  });

  appModule.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      appModule.quit();
    }
  });

  return startup;
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
  initializeBackendRouting,
  showStartupErrorAndQuit,
  startDesktopApp,
};
