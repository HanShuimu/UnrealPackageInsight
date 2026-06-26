const assert = require('node:assert/strict');
const test = require('node:test');

const {
  analyzeContainer,
  createContainerOperationContext,
  exportPackagesCsv,
  extractContainer,
  listSiblingContainerFiles,
  normalizeCsvOutputPath,
} = require('../src/container-operations.js');

function dirent(name, file = true) {
  return {
    name,
    isFile() {
      return file;
    },
  };
}

function createFsModule(entries) {
  return {
    readdirSync(directory, options) {
      assert.equal(directory, 'C:\\Game');
      assert.deepEqual(options, { withFileTypes: true });
      return entries;
    },
  };
}

function createContextDependencies({
  analyzeResult = { status: 'OK', packages: [] },
  extractResult = { status: 'OK' },
} = {}) {
  const calls = {
    loadBackendManifests: 0,
    providerFactory: [],
    setSelection: [],
    serviceConstructors: [],
    analyze: [],
    extract: [],
  };
  const provider = {
    setSelection(filePath, backendId) {
      calls.setSelection.push({ filePath, backendId });
    },
  };
  class StubAnalysisService {
    constructor(options) {
      calls.serviceConstructors.push(options);
    }

    async analyze(filePath) {
      calls.analyze.push(filePath);
      return analyzeResult;
    }

    async extract(filePath, outputDirectory) {
      calls.extract.push({ filePath, outputDirectory });
      return extractResult;
    }
  }

  return {
    calls,
    provider,
    fsModule: createFsModule([
      dirent('Container.pak'),
      dirent('Container.utoc'),
      dirent('Container.ucas'),
      dirent('Notes.txt'),
    ]),
    koffiModule: { tag: 'koffi' },
    loadBackendManifests() {
      calls.loadBackendManifests += 1;
      return [{ id: 'ue5-main', dllPath: 'backend.dll' }];
    },
    providerFactory(options) {
      calls.providerFactory.push(options);
      return provider;
    },
    probeContainerFile() {
      return { containerType: 'pak' };
    },
    AnalysisService: StubAnalysisService,
  };
}

test('listSiblingContainerFiles lists same-directory container files only', () => {
  const files = listSiblingContainerFiles(
    'C:\\Game\\Container.pak',
    createFsModule([
      dirent('B.ucas'),
      dirent('A.PAK'),
      dirent('Container.utoc'),
      dirent('readme.txt'),
      dirent('Nested', false),
    ]),
  );

  assert.deepEqual(files, [
    'C:\\Game\\A.PAK',
    'C:\\Game\\B.ucas',
    'C:\\Game\\Container.utoc',
  ]);
});

test('createContainerOperationContext wires AES key, backend id, manifests, provider, and service', () => {
  const deps = createContextDependencies();

  const context = createContainerOperationContext({
    filePath: 'C:\\Game\\Container.pak',
    aesKey: '0xABCDEFABCDEFABCDEFABCDEFABCDEFAB',
    backendId: 'ue5-main',
    ...deps,
  });

  assert.equal(context.filePath, 'C:\\Game\\Container.pak');
  assert.deepEqual(context.filePaths, [
    'C:\\Game\\Container.pak',
    'C:\\Game\\Container.ucas',
    'C:\\Game\\Container.utoc',
  ]);
  assert.equal(context.aesSession.getKey(), 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal(deps.calls.loadBackendManifests, 1);
  assert.equal(deps.calls.providerFactory.length, 1);
  assert.deepEqual(deps.calls.providerFactory[0], {
    manifests: [{ id: 'ue5-main', dllPath: 'backend.dll' }],
    koffi: { tag: 'koffi' },
    probeContainerFile: deps.probeContainerFile,
  });
  assert.deepEqual(deps.calls.setSelection, [{
    filePath: 'C:\\Game\\Container.pak',
    backendId: 'ue5-main',
  }]);
  assert.equal(deps.calls.serviceConstructors.length, 1);
  assert.equal(deps.calls.serviceConstructors[0].backendClientProvider, deps.provider);
  assert.deepEqual(deps.calls.serviceConstructors[0].filePaths, context.filePaths);
  assert.equal(deps.calls.serviceConstructors[0].aesSession, context.aesSession);
  assert.equal(context.service instanceof deps.AnalysisService, true);
});

test('createContainerOperationContext binds explicit backend id to .utoc for .ucas selections', () => {
  const deps = createContextDependencies();

  createContainerOperationContext({
    filePath: 'C:\\Game\\Container.ucas',
    backendId: 'ue5-main',
    ...deps,
  });

  assert.deepEqual(deps.calls.setSelection, [{
    filePath: 'C:\\Game\\Container.utoc',
    backendId: 'ue5-main',
  }]);
});

test('createContainerOperationContext accepts injected file paths', () => {
  const deps = createContextDependencies();
  const context = createContainerOperationContext({
    filePath: 'C:\\Game\\Container.pak',
    filePaths: ['C:\\Game\\Container.pak'],
    fsModule: {
      readdirSync() {
        throw new Error('filePaths injection should bypass sibling discovery');
      },
    },
    koffiModule: deps.koffiModule,
    loadBackendManifests: deps.loadBackendManifests,
    providerFactory: deps.providerFactory,
    probeContainerFile: deps.probeContainerFile,
    AnalysisService: deps.AnalysisService,
  });

  assert.deepEqual(context.filePaths, ['C:\\Game\\Container.pak']);
});

test('analyzeContainer delegates to AnalysisService.analyze', async () => {
  const deps = createContextDependencies({ analyzeResult: { status: 'OK', value: 42 } });

  const result = await analyzeContainer({
    filePath: 'C:\\Game\\Container.pak',
    ...deps,
  });

  assert.deepEqual(result, { status: 'OK', value: 42 });
  assert.deepEqual(deps.calls.analyze, ['C:\\Game\\Container.pak']);
});

test('analyzeContainer supports injected context creation', async () => {
  const calls = [];
  const result = await analyzeContainer({
    filePath: 'C:\\Game\\Container.pak',
    createContext: async () => ({
      service: {
        async analyze(filePath) {
          calls.push(filePath);
          return { status: 'OK' };
        },
      },
    }),
  });

  assert.deepEqual(result, { status: 'OK' });
  assert.deepEqual(calls, ['C:\\Game\\Container.pak']);
});

test('extractContainer delegates to AnalysisService.extract and requires an output directory', async () => {
  const deps = createContextDependencies({ extractResult: { status: 'OK', extracted: 3 } });

  await assert.rejects(
    () => extractContainer({ filePath: 'C:\\Game\\Container.pak', outputDirectory: '   ', ...deps }),
    /outputDirectory is required/,
  );

  const result = await extractContainer({
    filePath: 'C:\\Game\\Container.pak',
    outputDirectory: 'C:\\Out',
    ...deps,
  });

  assert.deepEqual(result, { status: 'OK', extracted: 3 });
  assert.deepEqual(deps.calls.extract, [{
    filePath: 'C:\\Game\\Container.pak',
    outputDirectory: 'C:\\Out',
  }]);
});

test('normalizeCsvOutputPath appends .csv when missing', () => {
  assert.equal(normalizeCsvOutputPath('C:\\Reports\\packages'), 'C:\\Reports\\packages.csv');
  assert.equal(normalizeCsvOutputPath('C:\\Reports\\packages.CSV'), 'C:\\Reports\\packages.CSV');
});

test('exportPackagesCsv analyzes, serializes sorted rows, writes utf8, and returns counts', async () => {
  const deps = createContextDependencies({
    analyzeResult: {
      status: 'OK',
      backendId: 'ue5-main',
      packages: [
        { packagePath: '../../../Game/Beta.uasset', size: 20, compressedSize: 10, order: 2 },
        { packagePath: '../../../Game/Alpha.uasset', size: 30, compressedSize: 12, order: 1 },
      ],
    },
  });
  const writes = [];

  const result = await exportPackagesCsv({
    filePath: 'C:\\Game\\Container.pak',
    outputPath: 'C:\\Reports\\packages',
    writeFile: async (...args) => {
      writes.push(args);
    },
    ...deps,
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'C:\\Reports\\packages.csv');
  assert.equal(writes[0][2], 'utf8');
  assert.match(writes[0][1], /^\uFEFFFull Path,Size,Compressed,Order\r\n/);
  assert.match(writes[0][1], /\.\.\/\.\.\/\.\.\/Game\/Alpha\.uasset,30,12,1\r\n\.\.\/\.\.\/\.\.\/Game\/Beta\.uasset,20,10,2\r\n$/);
  assert.deepEqual(result, {
    status: 'OK',
    filePath: 'C:\\Reports\\packages.csv',
    packageCount: 2,
    byteCount: Buffer.byteLength(writes[0][1], 'utf8'),
    backendId: 'ue5-main',
  });
});

test('exportPackagesCsv refuses empty package exports', async () => {
  const deps = createContextDependencies({
    analyzeResult: { status: 'OK', backendId: 'ue5-main', packages: [] },
  });
  let wrote = false;

  await assert.rejects(
    () => exportPackagesCsv({
      filePath: 'C:\\Game\\Container.pak',
      outputPath: 'C:\\Reports\\packages.csv',
      writeFile: async () => {
        wrote = true;
      },
      ...deps,
    }),
    /No packages to export\./,
  );

  assert.equal(wrote, false);
});

test('createContainerOperationContext validates AES key before provider resolution', () => {
  let loadCalled = false;
  let providerCalled = false;

  assert.throws(
    () => createContainerOperationContext({
      filePath: 'C:\\Game\\Container.pak',
      aesKey: 'not-a-key',
      fsModule: createFsModule([dirent('Container.pak')]),
      koffiModule: { tag: 'koffi' },
      loadBackendManifests() {
        loadCalled = true;
        return [];
      },
      providerFactory() {
        providerCalled = true;
        return { setSelection() {} };
      },
      probeContainerFile() {
        return {};
      },
      AnalysisService: class {},
    }),
    /AES key must be 32 or 64 hex characters/,
  );

  assert.equal(loadCalled, false);
  assert.equal(providerCalled, false);
});
