const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createWindow,
  createDesktopState,
  createIpcHandlers,
  startDesktopApp,
} = require('../main.js');

test('backend:getInfo returns registry summary before any DLL is loaded', () => {
  const state = createDesktopState({
    backendRegistrySummary: {
      status: 'OK',
      backendCount: 1,
      backends: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
    },
  });
  const handlers = createIpcHandlers({ state });

  assert.deepEqual(handlers.getBackendInfo(), {
    status: 'OK',
    backendCount: 1,
    backends: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
  });
});

test('package:openDirectory creates AnalysisService with backendClientProvider', async () => {
  const backendClientProvider = { resolveForFile() {} };
  const state = createDesktopState({ backendClientProvider });
  const created = [];
  class FakeAnalysisService {
    constructor(options) {
      created.push(options);
    }
  }
  const handlers = createIpcHandlers({
    state,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: ['C:\\Paks'] }; } },
    scanPackageDirectory: async () => ({
      root: 'C:\\Paks',
      files: [{ path: 'C:\\Paks\\pakchunk0-Windows.pak' }],
      tree: { name: 'Paks', path: 'C:\\Paks', kind: 'directory', children: [] },
    }),
    AnalysisService: FakeAnalysisService,
  });

  await handlers.openPackageDirectory();

  assert.equal(created[0].backendClientProvider, backendClientProvider);
});

test('backend:choose stores selected backend for a file and updates provider', () => {
  const providerSelections = [];
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const selectedId = 'ue-5.7.4-win32-x64-development';
  const state = createDesktopState({
    backendClientProvider: {
      setSelection(filePath, backendId) {
        providerSelections.push({ filePath, backendId });
      },
    },
    pendingBackendSelections: new Map([[
      filePath,
      { candidates: [{ id: selectedId, label: 'UE 5.7.4 Development' }] },
    ]]),
  });
  const handlers = createIpcHandlers({ state });
  const request = {
    filePath,
    selectedId,
  };

  const result = handlers.chooseBackend(request);

  assert.equal(result, request.selectedId);
  assert.equal(state.backendSelections.get(request.filePath), request.selectedId);
  assert.equal(state.pendingBackendSelections.has(request.filePath), false);
  assert.deepEqual(providerSelections, [{
    filePath: request.filePath,
    backendId: request.selectedId,
  }]);
});

test('analysis:analyze stores pending backend candidates for chooser validation', async () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const candidates = [
    { id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' },
    { id: 'ue-5.7.4-win32-x64-shipping', label: 'UE 5.7.4 Shipping' },
  ];
  const state = createDesktopState();
  state.analysisService = {
    async analyze() {
      const error = new Error('Multiple compatible backends found.');
      error.code = 'backend.multiple_candidates';
      error.filePath = filePath;
      error.probe = { containerType: 'pak' };
      error.candidates = candidates;
      throw error;
    },
  };
  const handlers = createIpcHandlers({ state });

  const result = await handlers.analyze(filePath);

  assert.deepEqual(result.backendSelection, {
    filePath,
    probe: { containerType: 'pak' },
    candidates,
  });
  assert.deepEqual(state.pendingBackendSelections.get(filePath), {
    candidates,
    candidateIds: new Set(candidates.map((candidate) => candidate.id)),
  });
});

test('backend:choose rejects selections without pending candidates', () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({ state });

  const result = handlers.chooseBackend({
    filePath: 'C:\\Paks\\pakchunk0-Windows.pak',
    selectedId: 'ue-5.7.4-win32-x64-development',
  });

  assert.equal(result, '');
  assert.equal(state.backendSelections.size, 0);
});

test('backend:choose rejects ids outside pending candidates and preserves pending choice', () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const state = createDesktopState({
    pendingBackendSelections: new Map([[
      filePath,
      {
        candidates: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
        candidateIds: new Set(['ue-5.7.4-win32-x64-development']),
      },
    ]]),
  });
  const handlers = createIpcHandlers({ state });

  const result = handlers.chooseBackend({
    filePath,
    selectedId: 'ue-5.7.4-win32-x64-shipping',
  });

  assert.equal(result, '');
  assert.equal(state.backendSelections.size, 0);
  assert.equal(state.pendingBackendSelections.has(filePath), true);
});

test('backend:choose clears pending selection on cancel', () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const state = createDesktopState({
    pendingBackendSelections: new Map([[
      filePath,
      {
        candidates: [{ id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' }],
        candidateIds: new Set(['ue-5.7.4-win32-x64-development']),
      },
    ]]),
  });
  const handlers = createIpcHandlers({ state });

  const result = handlers.chooseBackend({ filePath, selectedId: '' });

  assert.equal(result, '');
  assert.equal(state.pendingBackendSelections.has(filePath), false);
  assert.equal(state.backendSelections.size, 0);
});

test('backend:requestSelection stores candidates for the current selected file', () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const candidates = [
    { id: 'ue-5.7.4-win32-x64-development', label: 'UE 5.7.4 Development' },
    { id: 'ue-5.7.4-win32-x64-shipping', label: 'UE 5.7.4 Shipping' },
  ];
  const state = createDesktopState();
  state.analysisService = {
    getBackendSelection() {
      return {
        filePath,
        analysisFilePath: filePath,
        probe: { containerType: 'pak' },
        candidates,
      };
    },
  };
  const handlers = createIpcHandlers({ state });

  const result = handlers.requestBackendSelection(filePath);

  assert.deepEqual(result, {
    filePath,
    analysisFilePath: filePath,
    probe: { containerType: 'pak' },
    candidates,
  });
  assert.deepEqual(state.pendingBackendSelections.get(filePath), {
    candidates,
    candidateIds: new Set(candidates.map((candidate) => candidate.id)),
  });
});

test('backend:getInfo returns an empty registry summary before routing initialization', () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({ state });

  const result = handlers.getBackendInfo();

  assert.deepEqual(result, {
    status: 'OK',
    backendCount: 0,
    backends: [],
  });
});

test('analysis:analyze returns package.not_open before a package directory is opened', async () => {
  const state = createDesktopState();
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

test('analysis:extractSelectedContainer returns package.not_open before a package directory is opened', async () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({ state });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'package.not_open',
      message: 'Open a package directory before extracting files.',
    }],
  });
});

test('analysis:extractSelectedContainer returns null when output directory selection is canceled', async () => {
  const state = createDesktopState();
  state.analysisService = {
    async extract() {
      throw new Error('extract should not run');
    },
  };
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      },
    },
  });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.equal(result, null);
});

test('analysis:extractSelectedContainer chooses a directory and calls analysis service extract', async () => {
  const calls = [];
  const state = createDesktopState();
  state.analysisService = {
    async extract(filePath, outputDirectory) {
      calls.push({ filePath, outputDirectory });
      return {
        status: 'OK',
        issues: [],
        containerPath: filePath,
        outputDirectory,
        extractedFileCount: 0,
        errorCount: 0,
      };
    },
  };
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog(options) {
        assert.deepEqual(options, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Extract to...',
        });
        return { canceled: false, filePaths: ['D:\\Extracted'] };
      },
    },
  });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak');

  assert.deepEqual(calls, [{ filePath: 'C:\\Paks\\A.pak', outputDirectory: 'D:\\Extracted' }]);
  assert.deepEqual(result, {
    status: 'OK',
    issues: [],
    containerPath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Extracted',
    extractedFileCount: 0,
    errorCount: 0,
  });
});

test('package:openDirectory scans the selected directory and creates analysis service', async () => {
  const backendClientProvider = { resolveForFile() {} };
  const state = createDesktopState({ backendClientProvider });
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
    backendClientProvider: options.backendClientProvider,
    filePaths: options.filePaths,
    aesSession: options.aesSession,
  })), [{
    backendClientProvider,
    filePaths: [scan.files[0].path],
    aesSession: state.aesSession,
  }]);
  assert.deepEqual(analysis, { status: 'OK', filePath: scan.files[0].path });
});

test('package:openDirectory returns null when directory selection is canceled', async () => {
  const state = createDesktopState();
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
  const state = createDesktopState();
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
      message: 'AES key must be 32 or 64 hex characters, or a Base64-encoded 16 or 32 byte key',
    }],
  });
  assert.equal(state.aesSession.getKey(), '');
  assert.equal(cleared, true);
});

test('analysis:submitAesKeyAndRetry accepts Unreal config Base64 AES keys', async () => {
  const calls = [];
  const state = createDesktopState();
  state.analysisService = {
    async analyze(filePath) {
      calls.push({ filePath, aesKey: state.aesSession.getKey() });
      return { status: 'OK', aesKey: state.aesSession.getKey() };
    },
  };
  const handlers = createIpcHandlers({ state });
  const filePath = 'C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak';

  const result = await handlers.submitAesKeyAndRetry(
    filePath,
    'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  );

  assert.deepEqual(result, {
    status: 'OK',
    aesKey: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  });
  assert.deepEqual(calls, [{
    filePath,
    aesKey: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  }]);
});

test('analysis:submitAesKeyAndRetry clears keys rejected by backend AES validation', async () => {
  const state = createDesktopState();
  state.analysisService = {
    async analyze() {
      return {
        status: 'Error',
        issues: [{
          severity: 'error',
          code: 'pak.aes_key_invalid',
          message: 'Pak analysis failed with the provided AES key.',
        }],
      };
    },
  };
  const handlers = createIpcHandlers({ state });

  const result = await handlers.submitAesKeyAndRetry(
    'C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak',
    'abcdefabcdefabcdefabcdefabcdefab',
  );

  assert.equal(state.aesSession.getKey(), '');
  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'pak.aes_key_invalid',
      message: 'Pak analysis failed with the provided AES key.',
    }],
  });
});

test('analysis:analyze clears session keys rejected by backend AES validation', async () => {
  const cases = [
    {
      code: 'pak.aes_key_invalid',
      message: 'Pak analysis failed with the provided AES key.',
    },
    {
      code: 'iostore.aes_key_required',
      message: 'IoStore container is encrypted and requires an AES key.',
    },
  ];

  for (const issue of cases) {
    const state = createDesktopState();
    state.aesSession.setKey('abcdefabcdefabcdefabcdefabcdefab');
    state.analysisService = {
      async analyze() {
        return {
          status: 'Error',
          issues: [{
            severity: 'error',
            code: issue.code,
            message: issue.message,
          }],
        };
      },
    };
    const handlers = createIpcHandlers({ state });

    const result = await handlers.analyze('C:\\Game\\Content\\Paks\\pakchunk0-Windows.pak');

    assert.equal(state.aesSession.getKey(), '');
    assert.deepEqual(result, {
      status: 'Error',
      issues: [{
        severity: 'error',
        code: issue.code,
        message: issue.message,
      }],
    });
  }
});

test('createWindow sets a minimum size that matches the renderer shell constraints', async () => {
  const createdWindows = [];
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.loadedFile = '';
      createdWindows.push(this);
    }

    async loadFile(filePath) {
      this.loadedFile = filePath;
    }
  }

  const window = await createWindow({ BrowserWindowClass: FakeBrowserWindow });

  assert.equal(window, createdWindows[0]);
  assert.equal(window.options.minWidth, 760);
  assert.equal(window.options.minHeight, 560);
  assert.match(window.loadedFile, /renderer-dist[\\/]index\.html$/);
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
    initializeBackendRouting: () => {
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
  assert.equal(handled.has('backend:choose'), true);
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
    initializeBackendRouting: () => ({}),
    createWindow: () => Promise.reject(new Error('renderer missing')),
  });

  assert.deepEqual(dialogs, [{
    title: 'UnrealPackageInsight failed to start',
    content: 'renderer missing',
  }]);
  assert.equal(quitCount, 1);
});
