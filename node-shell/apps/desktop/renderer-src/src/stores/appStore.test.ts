import { describe, expect, test } from 'vitest';
import { createAppStore } from './appStore';
import type { AnalysisResult, UpiClient } from '../types/upi';

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
    submitAesKeyAndRetry: async () => ({ status: 'OK', packages: [], compressedBlocks: [] }),
    clearAesKey: async () => true,
    chooseBackend: async (request) => request.selectedId || '',
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
});
