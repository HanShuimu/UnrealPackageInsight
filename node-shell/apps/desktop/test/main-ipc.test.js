const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDesktopState,
  createIpcHandlers,
  startDesktopApp,
} = require('../main.js');

test('backend:getInfo returns backend.not_ready before initialization', () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({ state });

  const result = handlers.getBackendInfo();

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'backend.not_ready',
      message: 'Backend is not initialized.',
    }],
  });
});

test('analysis:analyze returns package.not_open before a package directory is opened', async () => {
  const state = createDesktopState({ backendClient: { getBackendInfo() {} } });
  const handlers = createIpcHandlers({ state });

  const result = await handlers.analyze('C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'package.not_open',
      message: 'Open a package directory before analyzing files.',
    }],
  });
});

test('package:openDirectory scans the selected directory and creates analysis service', async () => {
  const backendClient = { getBackendInfo() {} };
  const state = createDesktopState({ backendClient });
  const scan = {
    root: 'C:\\Game\\Content\\Paks',
    files: [{ path: 'C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak' }],
    tree: { name: 'Paks', path: 'C:\\Game\\Content\\Paks', kind: 'directory', children: [] },
  };
  const createdServices = [];
  class FakeAnalysisService {
    constructor(options) {
      createdServices.push(options);
    }

    async analyze(filePath) {
      return { status: 'OK', filePath };
    }
  }
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [scan.root] };
      },
    },
    scanPackageDirectory: async (root) => {
      assert.equal(root, scan.root);
      return scan;
    },
    AnalysisService: FakeAnalysisService,
  });

  const result = await handlers.openPackageDirectory();
  const analysis = await handlers.analyze(scan.files[0].path);

  assert.equal(result, scan);
  assert.equal(state.currentScan, scan);
  assert.deepEqual(createdServices.map((options) => ({
    backendClient: options.backendClient,
    filePaths: options.filePaths,
    aesSession: options.aesSession,
  })), [{
    backendClient,
    filePaths: [scan.files[0].path],
    aesSession: state.aesSession,
  }]);
  assert.deepEqual(analysis, { status: 'OK', filePath: scan.files[0].path });
});

test('package:openDirectory returns null when directory selection is canceled', async () => {
  const state = createDesktopState({ backendClient: { getBackendInfo() {} } });
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      },
    },
    scanPackageDirectory: async () => {
      throw new Error('scan should not run');
    },
  });

  const result = await handlers.openPackageDirectory();

  assert.equal(result, null);
  assert.equal(state.currentScan, null);
  assert.equal(state.analysisService, null);
});

test('analysis:submitAesKeyAndRetry stores valid AES keys, retries, and reports invalid keys safely', async () => {
  const calls = [];
  const state = createDesktopState({ backendClient: { getBackendInfo() {} } });
  state.analysisService = {
    async analyze(filePath) {
      calls.push({ filePath, aesKey: state.aesSession.getKey() });
      return { status: 'OK', aesKey: state.aesSession.getKey() };
    },
  };
  const handlers = createIpcHandlers({ state });
  const filePath = 'C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak';

  const retried = await handlers.submitAesKeyAndRetry(filePath, '0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const invalid = await handlers.submitAesKeyAndRetry(filePath, 'not-a-key');
  const cleared = await handlers.clearAesKey();

  assert.deepEqual(retried, { status: 'OK', aesKey: 'abcdefabcdefabcdefabcdefabcdefab' });
  assert.deepEqual(calls, [{ filePath, aesKey: 'abcdefabcdefabcdefabcdefabcdefab' }]);
  assert.deepEqual(invalid, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'aes.invalid_key',
      message: 'AES key must be 32 or 64 hex characters',
    }],
  });
  assert.equal(state.aesSession.getKey(), '');
  assert.equal(cleared, true);
});

test('startDesktopApp shows an error dialog and quits when startup initialization fails', async () => {
  const handled = new Map();
  const appEvents = new Map();
  const dialogs = [];
  let quitCount = 0;
  const app = {
    whenReady() {
      return Promise.resolve();
    },
    on(name, handler) {
      appEvents.set(name, handler);
    },
    quit() {
      quitCount += 1;
    },
  };
  const ipcMain = {
    handle(name, handler) {
      handled.set(name, handler);
    },
  };
  const dialog = {
    showErrorBox(title, content) {
      dialogs.push({ title, content });
    },
  };

  await startDesktopApp({
    app,
    BrowserWindowClass: { getAllWindows: () => [] },
    dialog,
    ipcMain,
    initializeBackendClient: () => {
      throw new Error('DLL missing');
    },
    createWindow: () => {
      throw new Error('window should not be created');
    },
  });

  assert.deepEqual(dialogs, [{
    title: 'UnrealPackageInsight failed to start',
    content: 'DLL missing',
  }]);
  assert.equal(quitCount, 1);
  assert.equal(handled.has('backend:getInfo'), true);
  assert.equal(appEvents.has('window-all-closed'), true);
});

test('startDesktopApp catches asynchronous createWindow load failures and quits', async () => {
  const dialogs = [];
  let quitCount = 0;
  const app = {
    whenReady() {
      return Promise.resolve();
    },
    on() {},
    quit() {
      quitCount += 1;
    },
  };
  const ipcMain = {
    handle() {},
  };
  const dialog = {
    showErrorBox(title, content) {
      dialogs.push({ title, content });
    },
  };

  await startDesktopApp({
    app,
    BrowserWindowClass: { getAllWindows: () => [] },
    dialog,
    ipcMain,
    initializeBackendClient: () => ({ getBackendInfo() {} }),
    createWindow: () => Promise.reject(new Error('renderer missing')),
  });

  assert.deepEqual(dialogs, [{
    title: 'UnrealPackageInsight failed to start',
    content: 'renderer missing',
  }]);
  assert.equal(quitCount, 1);
});
