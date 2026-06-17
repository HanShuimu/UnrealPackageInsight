const assert = require('node:assert/strict');
const test = require('node:test');

const { main } = require('../src/index.js');

test('list-backends prints manifest ids', () => {
  const output = [];
  const exitState = {};

  main({
    argv: ['node', 'index.js', 'list-backends'],
    log: (line) => output.push(line),
    processController: exitState,
    loadBackendManifests: () => [
      { id: 'ue-5.7.4-win32-x64-development', engineVersion: '5.7.4', configuration: 'Development' },
    ],
  });

  assert.deepEqual(output, ['ue-5.7.4-win32-x64-development UE 5.7.4 Development']);
  assert.equal(exitState.exitCode ?? 0, 0);
});

test('analyze reports multiple candidates without backend id', async () => {
  const output = [];
  const exitState = {};

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\pakchunk0-Windows.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    loadBackendManifests: () => [
      { id: 'a', engineVersion: '5.7.4', configuration: 'Development', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
      { id: 'b', engineVersion: '5.7.4', configuration: 'Shipping', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
    ],
  });

  assert.equal(exitState.exitCode, 1);
  assert.match(output.join('\n'), /Multiple compatible backends found/);
  assert.match(output.join('\n'), /--backend-id a/);
});

test('analyze rejects an invalid backend id without creating a provider', async () => {
  const output = [];
  const exitState = {};
  let providerCallCount = 0;

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\pakchunk0-Windows.pak', '--backend-id', 'missing'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    loadBackendManifests: () => [
      { id: 'a', engineVersion: '5.7.4', configuration: 'Development', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
      { id: 'b', engineVersion: '5.7.4', configuration: 'Shipping', protocolVersion: 1, supports: { pak: { versionMin: 1, versionMax: 12 } } },
    ],
    providerFactory: () => {
      providerCallCount += 1;
      throw new Error('provider should not be created for invalid backend id');
    },
  });

  assert.equal(exitState.exitCode, 1);
  assert.equal(providerCallCount, 0);
  assert.match(output.join('\n'), /Multiple compatible backends found/);
  assert.match(output.join('\n'), /--backend-id a/);
});

test('analyze uses a single compatible backend provider and prints analysis JSON', async () => {
  const output = [];
  const exitState = {};
  const calls = [];
  const manifests = [
    {
      id: 'ue-5.7.4-win32-x64-development',
      engineVersion: '5.7.4',
      configuration: 'Development',
      protocolVersion: 1,
      supports: { pak: { versionMin: 1, versionMax: 12 } },
    },
  ];

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\pakchunk0-Windows.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: () => ({ containerType: 'pak', pakFormatVersion: 12 }),
    loadBackendManifests: () => manifests,
    providerFactory: (options) => {
      calls.push({ type: 'providerFactory', options });
      return {
        getBackendClient(backendId) {
          calls.push({ type: 'getBackendClient', backendId });
          return {
            async analyzePak(request) {
              calls.push({ type: 'analyzePak', request });
              return { status: 'OK', backendId, assetCount: 3 };
            },
          };
        },
      };
    },
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(JSON.parse(output[0]), {
    status: 'OK',
    backendId: 'ue-5.7.4-win32-x64-development',
    assetCount: 3,
  });
  assert.equal(calls[0].type, 'providerFactory');
  assert.equal(calls[0].options.manifests, manifests);
  assert.equal(calls[1].backendId, 'ue-5.7.4-win32-x64-development');
  assert.deepEqual(calls[2], {
    type: 'analyzePak',
    request: { pakPath: 'C:\\Paks\\pakchunk0-Windows.pak', aesKey: '' },
  });
});

test('analyze resolves a selected UCAS to its UTOC before IoStore analysis', async () => {
  const output = [];
  const exitState = {};
  const calls = [];
  const manifests = [
    {
      id: 'ue-5.7.4-win32-x64-development',
      engineVersion: '5.7.4',
      configuration: 'Development',
      protocolVersion: 1,
      supports: { iostore: { tocVersionMin: 1, tocVersionMax: 8 } },
    },
  ];

  await main({
    argv: ['node', 'index.js', 'analyze', 'C:\\Paks\\global.ucas'],
    log: (line) => output.push(line),
    processController: exitState,
    filePaths: ['C:\\Paks\\global.utoc', 'C:\\Paks\\global.ucas'],
    probeContainerFile: (filePath) => {
      calls.push({ type: 'probeContainerFile', filePath });
      assert.equal(filePath, 'C:\\Paks\\global.utoc');
      return { containerType: 'iostore', utocPath: filePath, tocFormatVersion: 8 };
    },
    loadBackendManifests: () => manifests,
    providerFactory: () => ({
      getBackendClient(backendId) {
        calls.push({ type: 'getBackendClient', backendId });
        return {
          async analyzeIoStore(request) {
            calls.push({ type: 'analyzeIoStore', request });
            return { status: 'OK', containerType: 'iostore' };
          },
        };
      },
    }),
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(JSON.parse(output[0]), { status: 'OK', containerType: 'iostore' });
  assert.deepEqual(calls, [
    { type: 'probeContainerFile', filePath: 'C:\\Paks\\global.utoc' },
    { type: 'getBackendClient', backendId: 'ue-5.7.4-win32-x64-development' },
    {
      type: 'analyzeIoStore',
      request: {
        utocPath: 'C:\\Paks\\global.utoc',
        ucasPath: 'C:\\Paks\\global.ucas',
        aesKey: '',
      },
    },
  ]);
});

test('probe prints container probe JSON', () => {
  const output = [];
  const exitState = {};

  main({
    argv: ['node', 'index.js', 'probe', 'C:\\Paks\\pakchunk0-Windows.pak'],
    log: (line) => output.push(line),
    processController: exitState,
    probeContainerFile: (filePath) => ({
      containerType: 'pak',
      path: filePath,
      pakFormatVersion: 12,
    }),
  });

  assert.equal(exitState.exitCode ?? 0, 0);
  assert.deepEqual(JSON.parse(output[0]), {
    containerType: 'pak',
    path: 'C:\\Paks\\pakchunk0-Windows.pak',
    pakFormatVersion: 12,
  });
});
