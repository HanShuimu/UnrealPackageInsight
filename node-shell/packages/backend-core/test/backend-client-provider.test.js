const assert = require('node:assert/strict');
const test = require('node:test');

const { createBackendClientProvider } = require('../src/backend-client-provider.js');

function createPakManifest(overrides = {}) {
  return {
    id: 'ue-5.7.4-win32-x64-development',
    dllPath: 'C:\\backend\\dev.dll',
    engineVersion: '5.7.4',
    configuration: 'Development',
    protocolVersion: 1,
    supports: { pak: { versionMin: 1, versionMax: 12 } },
    ...overrides,
  };
}

test('provider creates and caches clients by backend id', () => {
  const created = [];
  const provider = createBackendClientProvider({
    manifests: [
      { id: 'ue-5.7.4-win32-x64-development', dllPath: 'C:\\backend\\dev.dll' },
    ],
    koffi: {},
    backendClientFactory({ dllPath }) {
      created.push(dllPath);
      return { dllPath };
    },
    probeContainerFile() {
      return { containerType: 'pak', pakFormatVersion: 12 };
    },
  });

  assert.deepEqual(provider.getBackendClient('ue-5.7.4-win32-x64-development'), { dllPath: 'C:\\backend\\dev.dll' });
  assert.deepEqual(provider.getBackendClient('ue-5.7.4-win32-x64-development'), { dllPath: 'C:\\backend\\dev.dll' });
  assert.deepEqual(created, ['C:\\backend\\dev.dll']);
});

test('provider resolves a file through probe and selector when there is one candidate', async () => {
  const provider = createBackendClientProvider({
    manifests: [createPakManifest()],
    koffi: {},
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    backendClientFactory({ dllPath }) {
      return { dllPath };
    },
  });

  assert.deepEqual(await provider.resolveForFile('C:\\Paks\\pakchunk0-Windows.pak'), {
    backendId: 'ue-5.7.4-win32-x64-development',
    client: { dllPath: 'C:\\backend\\dev.dll' },
  });
});

test('provider resolveForFile works when extracted as a callback', async () => {
  const provider = createBackendClientProvider({
    manifests: [createPakManifest()],
    koffi: {},
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    backendClientFactory({ dllPath }) {
      return { dllPath };
    },
  });
  const resolve = provider.resolveForFile;

  assert.deepEqual(await resolve('C:\\Paks\\pakchunk0-Windows.pak'), {
    backendId: 'ue-5.7.4-win32-x64-development',
    client: { dllPath: 'C:\\backend\\dev.dll' },
  });
});

test('provider throws structured error for remembered missing backend id', async () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const provider = createBackendClientProvider({
    manifests: [createPakManifest()],
    koffi: {},
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    backendClientFactory({ dllPath }) {
      return { dllPath };
    },
  });
  provider.setSelection(filePath, 'missing');

  await assert.rejects(
    provider.resolveForFile(filePath),
    (error) => {
      assert.equal(error.code, 'backend.no_compatible_backend');
      assert.equal(error.backendId, 'missing');
      assert.equal(error.filePath, filePath);
      return true;
    },
  );
});

test('provider multiple-candidate error includes candidate metadata', async () => {
  const filePath = 'C:\\Paks\\pakchunk0-Windows.pak';
  const provider = createBackendClientProvider({
    manifests: [
      createPakManifest(),
      createPakManifest({
        id: 'ue-5.7.4-win32-x64-shipping',
        dllPath: 'C:\\backend\\ship.dll',
        configuration: 'Shipping',
      }),
    ],
    koffi: {},
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    backendClientFactory({ dllPath }) {
      return { dllPath };
    },
  });

  await assert.rejects(
    provider.resolveForFile(filePath),
    (error) => {
      assert.equal(error.code, 'backend.multiple_candidates');
      assert.equal(error.filePath, filePath);
      assert.deepEqual(error.candidates, [
        {
          id: 'ue-5.7.4-win32-x64-development',
          label: 'UE 5.7.4 Development',
          engineVersion: '5.7.4',
          configuration: 'Development',
        },
        {
          id: 'ue-5.7.4-win32-x64-shipping',
          label: 'UE 5.7.4 Shipping',
          engineVersion: '5.7.4',
          configuration: 'Shipping',
        },
      ]);
      return true;
    },
  );
});
