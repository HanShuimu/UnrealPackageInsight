import { describe, expect, test } from 'vitest';
import { createAppStore } from './appStore';
import type { AnalysisResult, BackendSelectionRequest, ExtractResult, PackageScan, UpiClient } from '../types/upi';

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
    choosePackagesCsvSavePath: async () => ({ filePath: 'C:\\Exports\\packages.csv' }),
    writePackagesCsv: async (filePath, csvText) => ({
      filePath,
      byteCount: new TextEncoder().encode(csvText).byteLength,
    }),
    submitAesKeyAndRetry: async () => ({ status: 'OK', packages: [], compressedBlocks: [] }),
    clearAesKey: async () => true,
    chooseBackend: async (request) => request.selectedId || '',
    requestBackendSelection: async () => null,
    ...overrides,
  };
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
});
