const assert = require('node:assert/strict');
const test = require('node:test');

const { createBackendClientProvider } = require('../src/backend-client-provider.js');

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
    manifests: [
      {
        id: 'ue-5.7.4-win32-x64-development',
        dllPath: 'C:\\backend\\dev.dll',
        engineVersion: '5.7.4',
        configuration: 'Development',
        protocolVersion: 1,
        supports: { pak: { versionMin: 1, versionMax: 12 } },
      },
    ],
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
