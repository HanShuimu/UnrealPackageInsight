const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AesKeySession } = require('../src/aes-key-session.js');
const { AnalysisService, hasAesRequiredIssue } = require('../src/analysis-service.js');

function createFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createBackendClient() {
  const calls = {
    pak: [],
    iostore: [],
  };
  return {
    calls,
    client: {
      async analyzePak(request) {
        calls.pak.push(request);
        return { status: 'OK', kind: 'pak', request };
      },
      async analyzeIoStore(request) {
        calls.iostore.push(request);
        return { status: 'OK', kind: 'iostore', request };
      },
    },
  };
}

test('calls analyzePak for .pak selections with the session AES key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const { calls, client } = createBackendClient();
  const aesSession = new AesKeySession();
  aesSession.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const service = new AnalysisService({ backendClient: client, filePaths: [pakPath], aesSession });

  const result = await service.analyze(pakPath);

  assert.equal(result.status, 'OK');
  assert.deepEqual(calls.pak, [{
    pakPath,
    aesKey: 'abcdefabcdefabcdefabcdefabcdefab',
  }]);
});

test('returns iostore.pair_missing before calling backend for orphan .ucas selections', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ucasPath = path.join(root, 'global.ucas');
  createFile(ucasPath, 'ucas');
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [ucasPath] });

  const result = await service.analyze(ucasPath);

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'iostore.pair_missing',
      message: 'Selected IoStore file is missing its matching .utoc or .ucas file.',
    }],
  });
  assert.deepEqual(calls.iostore, []);
});

test('calls analyzeIoStore with the resolved pair and session AES key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const utocPath = path.join(root, 'global.utoc');
  const ucasPath = path.join(root, 'global.ucas');
  createFile(utocPath, 'utoc');
  createFile(ucasPath, 'ucas');
  const { calls, client } = createBackendClient();
  const aesSession = new AesKeySession();
  aesSession.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const service = new AnalysisService({ backendClient: client, filePaths: [utocPath, ucasPath], aesSession });

  const result = await service.analyze(ucasPath);

  assert.equal(result.status, 'OK');
  assert.deepEqual(calls.iostore, [{
    utocPath,
    ucasPath,
    aesKey: 'abcdefabcdefabcdefabcdefabcdefab',
  }]);
});

test('reuses cached results for the same file stamps and AES key, then misses cache after AES key changes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const { calls, client } = createBackendClient();
  const aesSession = new AesKeySession();
  aesSession.setKey('0xABCDEFABCDEFABCDEFABCDEFABCDEFAB');
  const service = new AnalysisService({ backendClient: client, filePaths: [pakPath], aesSession });

  const first = await service.analyze(pakPath);
  const second = await service.analyze(pakPath);
  aesSession.setKey('0x11111111111111111111111111111111');
  const third = await service.analyze(pakPath);

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.equal(calls.pak.length, 2);
  assert.equal(calls.pak[0].aesKey, 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal(calls.pak[1].aesKey, '11111111111111111111111111111111');
});

test('misses the Pak cache when the selected file stamp changes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [pakPath] });

  const first = await service.analyze(pakPath);
  createFile(pakPath, 'pak-updated');
  const second = await service.analyze(pakPath);

  assert.notEqual(first, second);
  assert.equal(calls.pak.length, 2);
});

test('reuses IoStore cache entries when UTOC and all UCAS partition stamps are unchanged', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const utocPath = path.join(root, 'global.utoc');
  const ucasPath = path.join(root, 'global.ucas');
  const secondaryUcasPath = path.join(root, 'global_s1.ucas');
  createFile(utocPath, 'utoc');
  createFile(ucasPath, 'ucas');
  createFile(secondaryUcasPath, 'secondary');
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({
    backendClient: client,
    filePaths: [utocPath, ucasPath, secondaryUcasPath],
  });

  const first = await service.analyze(secondaryUcasPath);
  const second = await service.analyze(secondaryUcasPath);

  assert.equal(first, second);
  assert.equal(calls.iostore.length, 1);
});

test('misses IoStore cache when a secondary UCAS partition stamp changes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const utocPath = path.join(root, 'global.utoc');
  const ucasPath = path.join(root, 'global.ucas');
  const secondaryUcasPath = path.join(root, 'global_s1.ucas');
  createFile(utocPath, 'utoc');
  createFile(ucasPath, 'ucas');
  createFile(secondaryUcasPath, 'secondary');
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({
    backendClient: client,
    filePaths: [utocPath, ucasPath, secondaryUcasPath],
  });

  const first = await service.analyze(secondaryUcasPath);
  createFile(secondaryUcasPath, 'secondary-updated');
  const second = await service.analyze(secondaryUcasPath);

  assert.notEqual(first, second);
  assert.equal(calls.iostore.length, 2);
  assert.deepEqual(calls.iostore.map((call) => call.ucasPath), [ucasPath, ucasPath]);
});

test('returns container.unsupported for unsupported file types without calling backend', async () => {
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [] });

  const result = await service.analyze('C:\\Game\\Content\\Paks\\readme.txt');

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.unsupported',
      message: 'Unsupported container file type.',
    }],
  });
  assert.deepEqual(calls.pak, []);
  assert.deepEqual(calls.iostore, []);
});

test('returns container.file_unavailable for deleted files without calling backend', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  fs.unlinkSync(pakPath);
  const { calls, client } = createBackendClient();
  const service = new AnalysisService({ backendClient: client, filePaths: [pakPath] });

  const result = await service.analyze(pakPath);

  assert.deepEqual(result, {
    status: 'Error',
    issues: [{
      severity: 'error',
      code: 'container.file_unavailable',
      message: 'Selected container file is unavailable.',
    }],
  });
  assert.deepEqual(calls.pak, []);
});

test('detects AES-required issue codes by exact suffix', () => {
  assert.equal(hasAesRequiredIssue({
    issues: [
      { code: 'container.warning' },
      { code: 'pak.aes_key_required' },
    ],
  }), true);
  assert.equal(hasAesRequiredIssue({ issues: [{ code: 'pak.aes_key_required.extra' }] }), false);
  assert.equal(hasAesRequiredIssue({ issues: [{ code: 'pak_aes_key_required' }] }), false);
  assert.equal(hasAesRequiredIssue({ status: 'OK' }), false);
});

test('resolves backend by selected Pak file and includes backend id in cache key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const calls = [];
  const service = new AnalysisService({
    backendClientProvider: {
      async resolveForFile(filePath) {
        assert.equal(filePath, pakPath);
        return {
          backendId: 'ue-5.7.4-win32-x64-development',
          client: {
            async analyzePak(request) {
              calls.push(request);
              return { status: 'OK', backendId: 'ue-5.7.4-win32-x64-development' };
            },
          },
        };
      },
    },
    filePaths: [pakPath],
  });

  const first = await service.analyze(pakPath);
  const second = await service.analyze(pakPath);

  assert.equal(first, second);
  assert.deepEqual(calls, [{ pakPath, aesKey: '' }]);
});

test('adds the resolved backend id to Pak results before caching', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const service = new AnalysisService({
    backendClientProvider: {
      async resolveForFile() {
        return {
          backendId: 'ue-5.7.4-win32-x64-development',
          client: {
            async analyzePak() {
              return { status: 'OK', packages: [] };
            },
          },
        };
      },
    },
    filePaths: [pakPath],
  });

  const result = await service.analyze(pakPath);

  assert.equal(result.backendId, 'ue-5.7.4-win32-x64-development');
});

test('does not reuse cached Pak results across different backend ids', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upi-analysis-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pakPath = path.join(root, 'pakchunk0-Windows.pak');
  createFile(pakPath, 'pak');
  const calls = [];
  const backendIds = ['ue-5.7.4-win32-x64-development', 'ue-5.7.4-win32-x64-shipping'];
  const service = new AnalysisService({
    backendClientProvider: {
      async resolveForFile() {
        const backendId = backendIds[calls.length];
        return {
          backendId,
          client: {
            async analyzePak(request) {
              calls.push({ backendId, request });
              return { status: 'OK', backendId };
            },
          },
        };
      },
    },
    filePaths: [pakPath],
  });

  const first = await service.analyze(pakPath);
  const second = await service.analyze(pakPath);

  assert.notEqual(first, second);
  assert.deepEqual(calls, [
    { backendId: 'ue-5.7.4-win32-x64-development', request: { pakPath, aesKey: '' } },
    { backendId: 'ue-5.7.4-win32-x64-shipping', request: { pakPath, aesKey: '' } },
  ]);
});
