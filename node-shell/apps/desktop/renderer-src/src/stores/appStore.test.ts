import { describe, expect, test } from 'vitest';
import { createAppStore } from './appStore';
import type {
  AnalysisResult,
  BackendSelectionRequest,
  ExtractResult,
  PackageScan,
  PackagesCsvExportResult,
  UpiClient,
} from '../types/upi';
import type {
  PackageRow,
  PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createScan(root: string, names: string[]): PackageScan {
  return {
    root,
    files: names.map((name) => ({ path: `${root}\\${name}`, name })),
    tree: {
      name: root.split('\\').pop() || root,
      path: root,
      kind: 'directory',
      children: names.map((name) => ({ name, path: `${root}\\${name}`, kind: 'pak' })),
    },
  };
}

function createBackendSelection(filePath: string): BackendSelectionRequest {
  return {
    filePath,
    containerLabel: 'A.pak',
    candidates: [{ id: 'test-backend', label: 'Test Backend' }],
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createClient(overrides: Partial<UpiClient> = {}): UpiClient {
  return {
    getBackendInfo: async () => ({ status: 'OK', backendName: 'TestBackend' }),
    openPackageDirectory: async () => ({
      root: 'C:\\Paks',
      files: [{ path: 'C:\\Paks\\A.pak', name: 'A.pak' }],
      tree: {
        name: 'Paks',
        path: 'C:\\Paks',
        kind: 'directory',
        children: [{ name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak' }],
      },
    }),
    analyze: async (filePath) => ({ status: 'OK', overview: { filePath }, packages: [], compressedBlocks: [] }),
    extractSelectedContainer: async (filePath) => ({
      status: 'OK',
      containerPath: filePath,
      outputDirectory: 'C:\\Extracted',
      extractedFileCount: 0,
      errorCount: 0,
    }),
    exportPackagesCsv: async (_filePath, csvText) => ({
      canceled: false,
      filePath: 'D:\\Exports\\A.pak.packages.csv',
      byteCount: new TextEncoder().encode(csvText).byteLength,
    }),
    submitAesKeyAndRetry: async () => ({ status: 'OK', packages: [], compressedBlocks: [] }),
    clearAesKey: async () => true,
    chooseBackend: async (request) => request.selectedId || '',
    requestBackendSelection: async () => null,
    ...overrides,
  };
}

const exportRows: PackageRow[] = [
  {
    id: '../../../Game/A.uasset',
    fullPath: '../../../Game/A.uasset',
    fileName: 'A.uasset',
    size: 20,
    compressedSize: 10,
    physicalOrder: 1,
    source: {},
  },
];

async function exportPackagesCsv(
  store: ReturnType<typeof createAppStore>,
  rows: PackageRow[],
  sortState: PackageTableSortState,
): Promise<void> {
  const action = store.getState().exportPackagesCsv;
  if (!action) {
    throw new Error('Missing exportPackagesCsv action.');
  }
  await action(rows, sortState);
}

function dismissPackagesCsvExportDialog(store: ReturnType<typeof createAppStore>): void {
  const action = store.getState().dismissPackagesCsvExportDialog;
  if (!action) {
    throw new Error('Missing dismissPackagesCsvExportDialog action.');
  }
  action();
}

describe('appStore', () => {
  test('loads backend info and opens a package directory', async () => {
    const store = createAppStore(createClient());

    await store.getState().loadBackendInfo();
    await store.getState().openDirectory();

    expect(store.getState().backendInfo?.backendName).toBe('TestBackend');
    expect(store.getState().scan?.files).toHaveLength(1);
    expect(store.getState().statusText).toBe('1 file found');
  });

  test('ignores stale analysis results after a newer file is selected', async () => {
    let resolveFirst: (value: AnalysisResult) => void = () => {};
    const first = new Promise<AnalysisResult>((resolve) => {
      resolveFirst = resolve;
    });
    const calls: string[] = [];
    const store = createAppStore(
      createClient({
        analyze: (filePath) => {
          calls.push(filePath);
          return calls.length === 1
            ? first
            : Promise.resolve({ status: 'OK', overview: { selected: 'B' }, packages: [], compressedBlocks: [] });
        },
      }),
    );

    const firstRun = store.getState().analyzeFile('C:\\Paks\\A.pak');
    await store.getState().analyzeFile('C:\\Paks\\B.pak');
    resolveFirst({ status: 'OK', overview: { selected: 'A' }, packages: [], compressedBlocks: [] });
    await firstRun;

    expect(store.getState().selectedFilePath).toBe('C:\\Paks\\B.pak');
    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'B' });
  });

  test('openDirectory during in-flight analyze clears loading and ignores stale analysis result', async () => {
    const analysis = createDeferred<AnalysisResult>();
    const store = createAppStore(
      createClient({
        analyze: () => analysis.promise,
        openPackageDirectory: async () => createScan('C:\\NewPaks', ['B.pak']),
      }),
    );

    const analyzeRun = store.getState().analyzeFile('C:\\Paks\\A.pak');

    expect(store.getState().isAnalyzing).toBe(true);

    await store.getState().openDirectory();
    analysis.resolve({ status: 'OK', overview: { selected: 'A' }, packages: [], compressedBlocks: [] });
    await analyzeRun;

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().selectedFilePath).toBe('');
    expect(store.getState().scan?.root).toBe('C:\\NewPaks');
    expect(store.getState().analysisResult).toBeNull();
  });

  test('overlapping openDirectory only applies the latest result', async () => {
    const firstOpen = createDeferred<PackageScan | null>();
    const secondOpen = createDeferred<PackageScan | null>();
    let openCount = 0;
    const store = createAppStore(
      createClient({
        openPackageDirectory: () => {
          openCount += 1;
          return openCount === 1 ? firstOpen.promise : secondOpen.promise;
        },
      }),
    );

    const firstRun = store.getState().openDirectory();
    const secondRun = store.getState().openDirectory();

    secondOpen.resolve(createScan('C:\\Second', ['B.pak', 'C.pak']));
    await secondRun;
    firstOpen.resolve(createScan('C:\\First', ['A.pak']));
    await firstRun;

    expect(store.getState().scan?.root).toBe('C:\\Second');
    expect(store.getState().scan?.files).toHaveLength(2);
    expect(store.getState().statusText).toBe('2 files found');
    expect(store.getState().isOpeningDirectory).toBe(false);
  });

  test('invalid AES retry keeps the AES dialog open with the backend issue message', async () => {
    const store = createAppStore(
      createClient({
        analyze: async () => ({
          status: 'Error',
          issues: [{ severity: 'error', code: 'pak.aes_key_required', message: 'AES key required.' }],
          packages: [],
          compressedBlocks: [],
        }),
        submitAesKeyAndRetry: async () => ({
          status: 'Error',
          issues: [{ severity: 'error', code: 'aes.invalid_key', message: 'The AES key is invalid.' }],
          packages: [],
          compressedBlocks: [],
        }),
      }),
    );

    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    await store.getState().submitAesKey('bad-key');

    expect(store.getState().dialog.aesFilePath).toBe('C:\\Paks\\A.pak');
    expect(store.getState().dialog.aesMessage).toBe('The AES key is invalid.');
    expect(store.getState().statusText).toBe('AES key invalid');
    expect(store.getState().analysisResult?.issues?.[0]?.code).toBe('aes.invalid_key');
  });

  test('stale AES retry result does not overwrite after another file is selected', async () => {
    const retry = createDeferred<AnalysisResult>();
    const store = createAppStore(
      createClient({
        analyze: async (filePath) => (
          filePath.endsWith('A.pak')
            ? {
                status: 'Error',
                issues: [{ severity: 'error', code: 'pak.aes_key_required', message: 'AES key required.' }],
                packages: [],
                compressedBlocks: [],
              }
            : { status: 'OK', overview: { selected: 'B' }, packages: [], compressedBlocks: [] }
        ),
        submitAesKeyAndRetry: () => retry.promise,
      }),
    );

    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const retryRun = store.getState().submitAesKey('good-key');
    await store.getState().analyzeFile('C:\\Paks\\B.pak');
    retry.resolve({ status: 'OK', overview: { selected: 'A' }, packages: [], compressedBlocks: [] });
    await retryRun;

    expect(store.getState().selectedFilePath).toBe('C:\\Paks\\B.pak');
    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'B' });
    expect(store.getState().dialog.aesFilePath).toBe('');
  });

  test('stale backend selection for the same file does not reanalyze over newer state', async () => {
    const backendChoice = createDeferred<string>();
    let analyzeCount = 0;
    const store = createAppStore(
      createClient({
        analyze: async (filePath) => {
          analyzeCount += 1;
          if (analyzeCount === 1) {
            return {
              status: 'Error',
              issues: [{ severity: 'error', code: 'backend.multiple_candidates', message: 'Choose backend.' }],
              backendSelection: createBackendSelection(filePath),
            };
          }
          if (analyzeCount === 2) {
            return { status: 'OK', overview: { selected: 'newer' }, packages: [], compressedBlocks: [] };
          }
          return { status: 'OK', overview: { selected: 'stale-backend' }, packages: [], compressedBlocks: [] };
        },
        chooseBackend: () => backendChoice.promise,
      }),
    );

    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const chooseRun = store.getState().chooseBackend('test-backend');
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    backendChoice.resolve('test-backend');
    await chooseRun;

    expect(analyzeCount).toBe(2);
    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'newer' });
    expect(store.getState().dialog.backendSelection).toBeNull();
  });

  test('backend selection can resolve a paired UTOC while retrying the originally selected UCAS', async () => {
    const calls: Array<{ type: string; value: unknown }> = [];
    let analyzeCount = 0;
    const selectedUcas = 'C:\\Paks\\pakchunk0-Windows.ucas';
    const resolvedUtoc = 'C:\\Paks\\pakchunk0-Windows.utoc';
    const store = createAppStore(
      createClient({
        analyze: async (filePath) => {
          calls.push({ type: 'analyze', value: filePath });
          analyzeCount += 1;
          if (analyzeCount === 1) {
            return {
              status: 'Error',
              issues: [{ severity: 'error', code: 'backend.multiple_candidates', message: 'Choose backend.' }],
              backendSelection: createBackendSelection(resolvedUtoc),
            };
          }
          return { status: 'OK', overview: { selected: filePath }, packages: [], compressedBlocks: [] };
        },
        chooseBackend: async (request) => {
          calls.push({ type: 'chooseBackend', value: request });
          return request.selectedId || '';
        },
      }),
    );

    await store.getState().analyzeFile(selectedUcas);
    await store.getState().chooseBackend('test-backend');

    expect(store.getState().selectedFilePath).toBe(selectedUcas);
    expect(store.getState().analysisResult?.overview).toEqual({ selected: selectedUcas });
    expect(calls).toEqual([
      { type: 'analyze', value: selectedUcas },
      {
        type: 'chooseBackend',
        value: {
          ...createBackendSelection(resolvedUtoc),
          analysisFilePath: selectedUcas,
          selectedId: 'test-backend',
        },
      },
      { type: 'analyze', value: selectedUcas },
    ]);
  });

  test('opens backend selection on demand for the current selected file', async () => {
    const selectedUcas = 'C:\\Paks\\pakchunk0-Windows.ucas';
    const resolvedUtoc = 'C:\\Paks\\pakchunk0-Windows.utoc';
    const store = createAppStore(
      createClient({
        requestBackendSelection: async (filePath) => ({
          ...createBackendSelection(resolvedUtoc),
          analysisFilePath: filePath,
        }),
      }),
    );

    await store.getState().analyzeFile(selectedUcas);
    await store.getState().openBackendSelection();

    expect(store.getState().dialog.backendSelection).toEqual({
      ...createBackendSelection(resolvedUtoc),
      analysisFilePath: selectedUcas,
    });
    expect(store.getState().statusText).toBe('Choose backend');
  });

  test('stale backend cancel error does not overwrite newer same-file analysis', async () => {
    const backendCancel = createDeferred<string>();
    let analyzeCount = 0;
    const store = createAppStore(
      createClient({
        analyze: async (filePath) => {
          analyzeCount += 1;
          if (analyzeCount === 1) {
            return {
              status: 'Error',
              issues: [{ severity: 'error', code: 'backend.multiple_candidates', message: 'Choose backend.' }],
              backendSelection: createBackendSelection(filePath),
            };
          }
          return { status: 'OK', overview: { selected: 'newer' }, packages: [], compressedBlocks: [] };
        },
        chooseBackend: () => backendCancel.promise,
      }),
    );

    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    store.getState().cancelBackendDialog();
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    backendCancel.reject(new Error('Cancel failed'));
    await flushPromises();

    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'newer' });
    expect(store.getState().statusText).toBe('Analysis ready');
  });

  test('extractSelectedContainer reports cancel without changing the analysis result', async () => {
    const store = createAppStore(
      createClient({
        extractSelectedContainer: async () => null,
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await store.getState().extractSelectedContainer();

    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('Extract canceled');
    expect(store.getState().isExtracting).toBe(false);
  });

  test('extractSelectedContainer keeps analysis data on success and reports completion', async () => {
    const store = createAppStore(createClient());
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await store.getState().extractSelectedContainer();

    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('Extract complete');
    expect(store.getState().isExtracting).toBe(false);
  });

  test('extractSelectedContainer converts extract failures into visible issue results', async () => {
    const store = createAppStore(
      createClient({
        extractSelectedContainer: async () => ({
          status: 'Error',
          issues: [{ severity: 'error', code: 'extract.failed', message: 'Extraction failed.' }],
          containerPath: 'C:\\Paks\\A.pak',
          outputDirectory: 'D:\\Out',
          extractedFileCount: 0,
          errorCount: 1,
        }),
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    await store.getState().extractSelectedContainer();

    expect(store.getState().statusText).toBe('Extract failed');
    expect(store.getState().analysisResult?.issues?.[0]?.code).toBe('extract.failed');
    expect(store.getState().isExtracting).toBe(false);
  });

  test('stale extract failure does not overwrite newer same-file analysis result', async () => {
    const extract = createDeferred<ExtractResult | null>();
    let analyzeCount = 0;
    const store = createAppStore(
      createClient({
        analyze: async () => {
          analyzeCount += 1;
          return {
            status: 'OK',
            overview: { selected: analyzeCount === 1 ? 'initial' : 'newer' },
            packages: [],
            compressedBlocks: [],
          };
        },
        extractSelectedContainer: () => extract.promise,
      }),
    );

    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const extractRun = store.getState().extractSelectedContainer();
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    extract.resolve({
      status: 'Error',
      issues: [{ severity: 'error', code: 'extract.failed', message: 'Extraction failed.' }],
      containerPath: 'C:\\Paks\\A.pak',
      outputDirectory: 'D:\\Out',
      extractedFileCount: 0,
      errorCount: 1,
    });
    await extractRun;

    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'newer' });
    expect(store.getState().analysisResult?.issues?.[0]?.code).not.toBe('extract.failed');
    expect(store.getState().statusText).toBe('Analysis ready');
    expect(store.getState().isExtracting).toBe(false);
  });

  test('extractSelectedContainer creates a fallback issue when error result has no issues', async () => {
    const store = createAppStore(
      createClient({
        extractSelectedContainer: async (filePath) => ({
          status: 'Error',
          issues: [],
          containerPath: filePath,
          outputDirectory: 'D:\\Out',
          extractedFileCount: 0,
          errorCount: 1,
        }),
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    await store.getState().extractSelectedContainer();

    expect(store.getState().statusText).toBe('Extract failed');
    expect(store.getState().analysisResult?.issues?.[0]).toEqual({
      severity: 'error',
      code: 'renderer.extract_failed',
      message: 'Extraction failed.',
    });
    expect(store.getState().isExtracting).toBe(false);
  });

  test('exportPackagesCsv reports cancel without changing analysis result', async () => {
    const store = createAppStore(
      createClient({
        exportPackagesCsv: async () => ({ canceled: true }),
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await exportPackagesCsv(store, exportRows, null);

    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('CSV export canceled');
    expect(store.getState().dialog.packagesCsvExport).toBeNull();
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('exportPackagesCsv writes csv and opens success dialog with singular count', async () => {
    const exports: Array<{ filePath: string; csvText: string }> = [];
    const store = createAppStore(
      createClient({
        exportPackagesCsv: async (filePath, csvText) => {
          exports.push({ filePath, csvText });
          return {
            canceled: false,
            filePath: 'D:\\Exports\\A.pak.packages.csv',
            byteCount: new TextEncoder().encode(csvText).byteLength,
          };
        },
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await exportPackagesCsv(store, exportRows, null);

    expect(exports).toEqual([
      {
        filePath: 'C:\\Paks\\A.pak',
        csvText: '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/A.uasset,20,10,1\r\n',
      },
    ]);
    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('CSV exported');
    expect(store.getState().dialog.packagesCsvExport).toEqual({
      kind: 'success',
      title: 'CSV exported',
      message: 'D:\\Exports\\A.pak.packages.csv\n1 package exported.',
    });
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('exportPackagesCsv success dialog uses plural count', async () => {
    const rows: PackageRow[] = [
      ...exportRows,
      {
        id: '../../../Game/B.uasset',
        fullPath: '../../../Game/B.uasset',
        fileName: 'B.uasset',
        size: 40,
        compressedSize: 30,
        physicalOrder: 2,
        source: {},
      },
    ];
    const store = createAppStore(createClient());
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    await exportPackagesCsv(store, rows, null);

    expect(store.getState().dialog.packagesCsvExport).toEqual({
      kind: 'success',
      title: 'CSV exported',
      message: 'D:\\Exports\\A.pak.packages.csv\n2 packages exported.',
    });
  });

  test('exportPackagesCsv shows failure dialog without mutating analysis issues', async () => {
    const store = createAppStore(
      createClient({
        analyze: async () => ({
          status: 'OK',
          issues: [{ severity: 'warning', code: 'analysis.warning', message: 'Original warning.' }],
          packages: [],
          compressedBlocks: [],
        }),
        exportPackagesCsv: async () => {
          throw new Error('Disk is full');
        },
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;
    const beforeIssues = store.getState().analysisResult?.issues;

    await exportPackagesCsv(store, exportRows, null);

    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().analysisResult?.issues).toBe(beforeIssues);
    expect(store.getState().statusText).toBe('CSV export failed');
    expect(store.getState().dialog.packagesCsvExport).toEqual({
      kind: 'error',
      title: 'CSV export failed',
      message: 'Disk is full',
    });
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('exportPackagesCsv refuses empty row exports without writing a file', async () => {
    const exports: Array<{ filePath: string; csvText: string }> = [];
    const store = createAppStore(
      createClient({
        exportPackagesCsv: async (filePath, csvText) => {
          exports.push({ filePath, csvText });
          return { canceled: false, filePath, byteCount: new TextEncoder().encode(csvText).byteLength };
        },
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await exportPackagesCsv(store, [], null);

    expect(store.getState().analysisResult).toBe(before);
    expect(exports).toEqual([]);
    expect(store.getState().statusText).toBe('CSV export failed');
    expect(store.getState().dialog.packagesCsvExport).toEqual({
      kind: 'error',
      title: 'CSV export failed',
      message: 'No packages to export.',
    });
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('exportPackagesCsv refuses export when no container is selected', async () => {
    const exports: Array<{ filePath: string; csvText: string }> = [];
    const store = createAppStore(
      createClient({
        exportPackagesCsv: async (filePath, csvText) => {
          exports.push({ filePath, csvText });
          return { canceled: false, filePath, byteCount: new TextEncoder().encode(csvText).byteLength };
        },
      }),
    );

    await exportPackagesCsv(store, exportRows, null);

    expect(store.getState().analysisResult).toBeNull();
    expect(exports).toEqual([]);
    expect(store.getState().statusText).toBe('CSV export failed');
    expect(store.getState().dialog.packagesCsvExport).toEqual({
      kind: 'error',
      title: 'CSV export failed',
      message: 'Select a container first.',
    });
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('exportPackagesCsv honors table sort state when writing csv rows', async () => {
    const exports: Array<{ filePath: string; csvText: string }> = [];
    const rows: PackageRow[] = [
      {
        id: '../../../Game/Small.uasset',
        fullPath: '../../../Game/Small.uasset',
        fileName: 'Small.uasset',
        size: 10,
        compressedSize: 5,
        physicalOrder: 1,
        source: {},
      },
      {
        id: '../../../Game/Large.uasset',
        fullPath: '../../../Game/Large.uasset',
        fileName: 'Large.uasset',
        size: 30,
        compressedSize: 20,
        physicalOrder: 2,
        source: {},
      },
    ];
    const sortState: PackageTableSortState = { columnKey: 'size', order: 'descend' };
    const store = createAppStore(
      createClient({
        exportPackagesCsv: async (filePath, csvText) => {
          exports.push({ filePath, csvText });
          return { canceled: false, filePath, byteCount: new TextEncoder().encode(csvText).byteLength };
        },
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    await exportPackagesCsv(store, rows, sortState);

    expect(exports[0]?.csvText).toBe(
      '\ufeffFull Path,Size,Compressed,Order\r\n'
      + '../../../Game/Large.uasset,30,20,2\r\n'
      + '../../../Game/Small.uasset,10,5,1\r\n',
    );
  });

  test('stale export is ignored if analysis changes before export resolves', async () => {
    const exportResult = createDeferred<PackagesCsvExportResult>();
    const exports: Array<{ filePath: string; csvText: string }> = [];
    const store = createAppStore(
      createClient({
        exportPackagesCsv: (filePath, csvText) => {
          exports.push({ filePath, csvText });
          return exportResult.promise;
        },
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');

    const exportRun = exportPackagesCsv(store, exportRows, null);
    await store.getState().analyzeFile('C:\\Paks\\B.pak');
    exportResult.resolve({ canceled: false, filePath: 'D:\\Exports\\A.pak.packages.csv', byteCount: 1 });
    await exportRun;

    expect(exports).toEqual([{
      filePath: 'C:\\Paks\\A.pak',
      csvText: '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/A.uasset,20,10,1\r\n',
    }]);
    expect(store.getState().selectedFilePath).toBe('C:\\Paks\\B.pak');
    expect(store.getState().statusText).toBe('Analysis ready');
    expect(store.getState().dialog.packagesCsvExport).toBeNull();
    expect(store.getState().isExportingPackagesCsv).toBe(false);
  });

  test('dismissPackagesCsvExportDialog clears only the csv export dialog', () => {
    const backendSelection = createBackendSelection('C:\\Paks\\A.pak');
    const store = createAppStore(createClient());
    store.setState({
      dialog: {
        aesFilePath: 'C:\\Paks\\A.pak',
        aesMessage: 'AES key required.',
        backendSelection,
        backendSelectionRequestId: 7,
        packagesCsvExport: {
          kind: 'error',
          title: 'CSV export failed',
          message: 'Disk is full',
        },
      },
    });

    dismissPackagesCsvExportDialog(store);

    expect(store.getState().dialog).toEqual({
      aesFilePath: 'C:\\Paks\\A.pak',
      aesMessage: 'AES key required.',
      backendSelection,
      backendSelectionRequestId: 7,
      packagesCsvExport: null,
    });
  });
});
