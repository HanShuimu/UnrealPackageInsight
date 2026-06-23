# Extract Status And Package Offset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an extraction-in-progress modal only while native extraction is actually running, and replace the Packages tab `Order` display with exact physical offsets.

**Architecture:** Split extraction into two renderer-visible stages: output directory selection, then extraction to the chosen directory. Normalize Pak `offset` and IoStore `firstOffset` into a BigInt-safe renderer field named `physicalOffset`, render it as fixed-width hex, and keep `order` only in raw decoded source objects.

**Tech Stack:** Electron IPC, React 19, TypeScript, Zustand, Ant Design 6, Vitest, node:test.

---

## Design Source

Use `docs/superpowers/specs/2026-06-23-extract-status-and-package-offset-design.md` as the source contract.

Key constraints:

- The extraction modal opens only after the output directory picker returns a directory.
- Directory picker cancel leaves the modal closed and reports `Extract canceled`.
- No fake percentage progress bar.
- Packages table and Details pane show `Offset`, not `Order`.
- Pak rows use `offset`; IoStore rows use `firstOffset`.
- 64-bit offsets are exact. Protocol decoders already return 64-bit values as `bigint`, so renderer normalization and formatting must preserve BigInt precision.
- This is a GUI change, so a fresh Electron GUI smoke test is required before completion.

## File Structure

- Modify `node-shell/apps/desktop/main.js`: split output directory selection from extraction and register the new IPC handler.
- Modify `node-shell/apps/desktop/preload.js`: expose `selectExtractOutputDirectory()` and update `extractSelectedContainer(filePath, outputDirectory)`.
- Modify `node-shell/apps/desktop/test/main-ipc.test.js`: cover split directory selection and extraction dispatch.
- Modify `node-shell/apps/desktop/renderer-src/src/types/upi.ts`: add `PhysicalOffset`, `ExtractModalState`, and the split extraction client methods.
- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`: add extract modal state and two-stage extraction lifecycle.
- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`: cover cancel, modal open, success, failure, and stale extraction lifecycle.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/format.ts`: add exact hex offset formatting.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/format.test.ts`: cover `number`, `bigint`, and missing offset formatting.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`: normalize physical offsets without numeric precision loss.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`: verify Pak and IoStore offset normalization and comparator behavior.
- Modify `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`: display and sort `Offset`.
- Modify `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`: update the column contract and rendering tests.
- Modify `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`: show formatted `Offset`.
- Modify `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`: update package detail expectations.
- Modify `node-shell/apps/desktop/renderer-src/src/App.tsx`: render the Ant Design extraction modal.
- Modify `node-shell/apps/desktop/renderer-src/src/App.test.tsx`: cover modal visibility and wiring.
- Modify `node-shell/apps/desktop/test/electron-gui-smoke.test.js`: verify `Extract to...` is visible after opening the Packages tab and the new preload method exists.

## Common Commands

- Main IPC tests:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js
```

- Renderer unit tests for this change:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts apps/desktop/renderer-src/src/utils/format.test.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx apps/desktop/renderer-src/src/components/DetailsPane.test.tsx apps/desktop/renderer-src/src/App.test.tsx
```

- Full node-shell tests:

```powershell
npm.cmd --prefix node-shell test
```

- Fresh Electron GUI smoke:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

---

## Task 1: Split Extract Directory Selection From Extraction IPC

**Files:**
- Modify: `node-shell/apps/desktop/test/main-ipc.test.js`
- Modify: `node-shell/apps/desktop/main.js`
- Modify: `node-shell/apps/desktop/preload.js`
- Modify: `node-shell/apps/desktop/renderer-src/src/types/upi.ts`

- [ ] **Step 1: Replace the directory-picker extraction IPC tests**

In `node-shell/apps/desktop/test/main-ipc.test.js`, replace these two tests:

- `analysis:extractSelectedContainer returns null when output directory selection is canceled`
- `analysis:extractSelectedContainer chooses a directory and calls analysis service extract`

with these three tests:

```js
test('analysis:selectExtractOutputDirectory returns null when output directory selection is canceled', async () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showOpenDialog(options) {
        assert.deepEqual(options, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Extract to...',
        });
        return { canceled: true, filePaths: [] };
      },
    },
  });

  const result = await handlers.selectExtractOutputDirectory();

  assert.equal(result, null);
});

test('analysis:selectExtractOutputDirectory returns the selected output directory', async () => {
  const state = createDesktopState();
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

  const result = await handlers.selectExtractOutputDirectory();

  assert.equal(result, 'D:\\Extracted');
});

test('analysis:extractSelectedContainer calls analysis service extract with the provided output directory', async () => {
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
  const handlers = createIpcHandlers({ state });

  const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak', 'D:\\Extracted');

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
```

Update the package-not-open test call in the same file to pass an output directory:

```js
const result = await handlers.extractSelectedContainer('C:\\Paks\\A.pak', 'D:\\Extracted');
```

- [ ] **Step 2: Run the IPC test and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js
```

Expected: FAIL because `handlers.selectExtractOutputDirectory` is not defined.

- [ ] **Step 3: Implement split handlers in Electron main**

In `node-shell/apps/desktop/main.js`, add `selectExtractOutputDirectory` before `extractSelectedContainer`, and replace the existing `extractSelectedContainer` body with direct extraction:

```js
    async selectExtractOutputDirectory() {
      const selection = await dialogModule.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Extract to...',
      });

      if (selection.canceled || selection.filePaths.length === 0) {
        return null;
      }

      return selection.filePaths[0];
    },

    async extractSelectedContainer(filePath, outputDirectory) {
      if (!state.analysisService) {
        return cloneResponse(PACKAGE_NOT_OPEN_EXTRACT_RESPONSE);
      }

      return state.analysisService.extract(filePath, outputDirectory);
    },
```

In `registerIpcHandlers`, register the new handler and pass the output directory through the existing extraction channel:

```js
  ipcMainModule.handle('analysis:selectExtractOutputDirectory', () => (
    handlers.selectExtractOutputDirectory()
  ));
  ipcMainModule.handle('analysis:extractSelectedContainer', (_event, filePath, outputDirectory) => (
    handlers.extractSelectedContainer(filePath, outputDirectory)
  ));
```

- [ ] **Step 4: Update preload API**

In `node-shell/apps/desktop/preload.js`, add the directory selection method and update extraction to take an output directory:

```js
  selectExtractOutputDirectory() {
    return ipcRenderer.invoke('analysis:selectExtractOutputDirectory');
  },

  extractSelectedContainer(filePath, outputDirectory) {
    return ipcRenderer.invoke('analysis:extractSelectedContainer', filePath, outputDirectory);
  },
```

- [ ] **Step 5: Update renderer IPC types**

In `node-shell/apps/desktop/renderer-src/src/types/upi.ts`, update the `UpiClient` extraction methods:

```ts
  selectExtractOutputDirectory(): Promise<string | null>;
  extractSelectedContainer(filePath: string, outputDirectory: string): Promise<ExtractResult>;
```

- [ ] **Step 6: Run the IPC test and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit IPC split**

Stage and commit only the IPC split files:

```powershell
git add -- node-shell/apps/desktop/main.js node-shell/apps/desktop/preload.js node-shell/apps/desktop/test/main-ipc.test.js node-shell/apps/desktop/renderer-src/src/types/upi.ts
git commit -m "Split extract directory selection from extraction"
```

---

## Task 2: Add Renderer Extract Modal Lifecycle

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/types/upi.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`

- [ ] **Step 1: Add failing store tests for the two-stage lifecycle**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`, update `createClient` so it includes the split method and extraction argument:

```ts
    selectExtractOutputDirectory: async () => 'C:\\Extracted',
    extractSelectedContainer: async (filePath, outputDirectory) => ({
      status: 'OK',
      containerPath: filePath,
      outputDirectory,
      extractedFileCount: 0,
      errorCount: 0,
    }),
```

Replace the existing cancel test with:

```ts
  test('extractSelectedContainer reports cancel before extraction starts and never opens the modal', async () => {
    const extractSelectedContainer = vi.fn(async () => {
      throw new Error('extract should not run after directory picker cancel');
    });
    const store = createAppStore(
      createClient({
        selectExtractOutputDirectory: async () => null,
        extractSelectedContainer,
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    await store.getState().extractSelectedContainer();

    expect(extractSelectedContainer).not.toHaveBeenCalled();
    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('Extract canceled');
    expect(store.getState().isExtracting).toBe(false);
    expect(store.getState().extractModal).toBeNull();
  });
```

Add this test after the cancel test:

```ts
  test('extractSelectedContainer opens the modal with container and output directory while extraction runs', async () => {
    const extract = createDeferred<ExtractResult>();
    const store = createAppStore(
      createClient({
        selectExtractOutputDirectory: async () => 'D:\\Extracted',
        extractSelectedContainer: (_filePath, _outputDirectory) => extract.promise,
      }),
    );
    await store.getState().analyzeFile('C:\\Paks\\A.pak');
    const before = store.getState().analysisResult;

    const run = store.getState().extractSelectedContainer();
    await flushPromises();

    expect(store.getState().isExtracting).toBe(true);
    expect(store.getState().statusText).toBe('Extracting...');
    expect(store.getState().extractModal).toEqual({
      containerPath: 'C:\\Paks\\A.pak',
      outputDirectory: 'D:\\Extracted',
    });

    extract.resolve({
      status: 'OK',
      issues: [],
      containerPath: 'C:\\Paks\\A.pak',
      outputDirectory: 'D:\\Extracted',
      extractedFileCount: 1,
      errorCount: 0,
    });
    await run;

    expect(store.getState().analysisResult).toBe(before);
    expect(store.getState().statusText).toBe('Extract complete');
    expect(store.getState().isExtracting).toBe(false);
    expect(store.getState().extractModal).toBeNull();
  });
```

Update the success, failure, stale, and fallback extraction tests so client overrides use the new signature:

```ts
extractSelectedContainer: async (_filePath, _outputDirectory) => ({
```

For stale extraction, add this assertion at the end:

```ts
    expect(store.getState().extractModal).toBeNull();
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: FAIL because `extractModal` and `selectExtractOutputDirectory` are not implemented.

- [ ] **Step 3: Add renderer extract modal types**

In `node-shell/apps/desktop/renderer-src/src/types/upi.ts`, add this exported type near `ExtractResult`:

```ts
export type ExtractModalState = {
  containerPath: string;
  outputDirectory: string;
};
```

- [ ] **Step 4: Implement store modal state and two-stage extraction**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`, import the new type:

```ts
  ExtractModalState,
```

Add this field to `AppState`:

```ts
  extractModal: ExtractModalState | null;
```

Add the initial value in `createAppStore`:

```ts
    extractModal: null,
```

Every path that invalidates extraction should also clear the modal. Add `extractModal: null` in the state updates inside `openDirectory()` and `analyzeFile()` where `isExtracting: false` is already set.

Replace `extractSelectedContainer()` with:

```ts
    async extractSelectedContainer() {
      const filePath = get().selectedFilePath;
      if (!filePath) {
        set({ statusText: 'Select a container first' });
        return;
      }

      const requestId = get().extractRequestId + 1;
      const analysisRequestId = get().analysisRequestId;
      set({
        extractRequestId: requestId,
        isExtracting: false,
        extractModal: null,
        statusText: 'Choosing extract target...',
      });

      try {
        const outputDirectory = await client.selectExtractOutputDirectory();
        if (!isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        if (!outputDirectory) {
          set({ statusText: 'Extract canceled', extractModal: null });
          return;
        }

        set({
          isExtracting: true,
          extractModal: { containerPath: filePath, outputDirectory },
          statusText: 'Extracting...',
        });

        const result = await client.extractSelectedContainer(filePath, outputDirectory);
        if (!isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        if (isErrorStatus(result.status)) {
          set({
            analysisResult: createAnalysisResultFromExtract(result),
            statusText: 'Extract failed',
          });
          return;
        }

        set({ statusText: 'Extract complete' });
      } catch (error) {
        if (!isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.extract_failed', error),
          statusText: 'Extract failed',
        });
      } finally {
        if (isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          set({ isExtracting: false, extractModal: null });
        }
      }
    },
```

- [ ] **Step 5: Run store tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add failing App tests for the extraction modal**

In `node-shell/apps/desktop/renderer-src/src/App.test.tsx`, update `createMockState` to include:

```ts
    extractModal: null,
```

Add tests near the extract action wiring test:

```tsx
  test('shows an extraction modal with container and output directory while extracting', () => {
    mockHarness.state = createMockState({
      isExtracting: true,
      extractModal: {
        containerPath: 'C:\\Paks\\A.pak',
        outputDirectory: 'D:\\Extracted',
      },
      statusText: 'Extracting...',
    });

    render(<App />);

    expect(screen.getByRole('dialog', { name: 'Extracting' })).toBeInTheDocument();
    expect(screen.getByText('Extracting files...')).toBeInTheDocument();
    expect(screen.getByText('C:\\Paks\\A.pak')).toBeInTheDocument();
    expect(screen.getByText('D:\\Extracted')).toBeInTheDocument();
  });

  test('keeps the extraction modal closed when extraction context is absent', () => {
    mockHarness.state = createMockState({
      isExtracting: true,
      extractModal: null,
      statusText: 'Choosing extract target...',
    });

    render(<App />);

    expect(screen.queryByRole('dialog', { name: 'Extracting' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run App tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/App.test.tsx
```

Expected: FAIL because `App` does not render the extraction modal.

- [ ] **Step 8: Render extraction modal in App**

In `node-shell/apps/desktop/renderer-src/src/App.tsx`, add `Modal` to the Ant Design import:

```ts
import { Button, Layout, Modal, Spin, Typography } from 'antd';
```

Read the modal state from the store:

```ts
  const extractModal = useAppStore((state) => state.extractModal);
```

Add this JSX before `</Layout>` and after the existing dialogs:

```tsx
      <Modal
        closable={false}
        footer={null}
        maskClosable={false}
        open={Boolean(isExtracting && extractModal)}
        title="Extracting"
      >
        <div className="extract-modal-body">
          <Spin />
          <Typography.Text strong>Extracting files...</Typography.Text>
          <div className="extract-modal-paths">
            <Typography.Text className="summary-label">Container</Typography.Text>
            <Typography.Text copyable ellipsis title={extractModal?.containerPath}>
              {extractModal?.containerPath}
            </Typography.Text>
            <Typography.Text className="summary-label">Output</Typography.Text>
            <Typography.Text copyable ellipsis title={extractModal?.outputDirectory}>
              {extractModal?.outputDirectory}
            </Typography.Text>
          </div>
        </div>
      </Modal>
```

Add CSS in `node-shell/apps/desktop/renderer-src/src/styles.css`:

```css
.extract-modal-body {
  display: grid;
  gap: 12px;
}

.extract-modal-paths {
  display: grid;
  gap: 6px;
  min-width: 0;
}
```

- [ ] **Step 9: Run App tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Run focused renderer extraction tests and commit**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add -- node-shell/apps/desktop/renderer-src/src/types/upi.ts node-shell/apps/desktop/renderer-src/src/stores/appStore.ts node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Show modal while extracting containers"
```

---

## Task 3: Normalize And Format Physical Offsets

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/format.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/format.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`

- [ ] **Step 1: Add failing tests for hex offset formatting**

In `node-shell/apps/desktop/renderer-src/src/utils/format.test.ts`, add:

```ts
import { describe, expect, test } from 'vitest';
import { formatHexOffset, formatLabel, formatValue } from './format';

describe('formatHexOffset', () => {
  test('formats number offsets as fixed-width uppercase hex', () => {
    expect(formatHexOffset(0)).toBe('0x0000000000000000');
    expect(formatHexOffset(0x1234abcd)).toBe('0x000000001234ABCD');
  });

  test('formats bigint offsets without losing 64-bit precision', () => {
    expect(formatHexOffset(0x123456789ABCDEFn)).toBe('0x0123456789ABCDEF');
    expect(formatHexOffset(0xFFFFFFFFFFFFFFFFn)).toBe('0xFFFFFFFFFFFFFFFF');
  });

  test('returns blank for missing or invalid offsets', () => {
    expect(formatHexOffset(undefined)).toBe('');
    expect(formatHexOffset(null)).toBe('');
    expect(formatHexOffset(Number.NaN)).toBe('');
    expect(formatHexOffset(-1)).toBe('');
    expect(formatHexOffset(-1n)).toBe('');
  });
});
```

Keep the existing `formatLabel` and `formatValue` imports in the same file. The final import should name all used helpers once.

- [ ] **Step 2: Run format tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/format.test.ts
```

Expected: FAIL because `formatHexOffset` is not exported.

- [ ] **Step 3: Implement BigInt-safe offset formatting**

In `node-shell/apps/desktop/renderer-src/src/utils/format.ts`, add:

```ts
export type HexOffsetInput = number | bigint | null | undefined;

function offsetToBigInt(value: HexOffsetInput): bigint | undefined {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }

  return undefined;
}

export function formatHexOffset(value: HexOffsetInput): string {
  const offset = offsetToBigInt(value);
  if (offset === undefined) {
    return '';
  }

  return `0x${offset.toString(16).toUpperCase().padStart(16, '0')}`;
}
```

- [ ] **Step 4: Run format tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/format.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing view-model tests for Pak and IoStore physical offsets**

In `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`, replace imports of `comparePackageOrder` with `comparePackageOffset`.

Update `pakResult` package entries so they include offsets:

```ts
    { packagePath: '../../../Game/Zeta/Beta.uasset', size: 3000, compressedSize: 1200, offset: 0x2000n, order: 8 },
    { packagePath: '../../../Engine/Config/Base.ini', size: 1300, compressedSize: 900, offset: 0x1000n, order: 1 },
```

Update the expected normalized rows in `normalizes backend package entries and sorts by file basename` to include `physicalOffset` and remove `physicalOrder` expectations:

```ts
        physicalOffset: 0x1000n,
```

and:

```ts
        physicalOffset: 0x2000n,
```

Add this test in the `buildPackageRows` describe block:

```ts
  test('normalizes Pak offset and IoStore firstOffset without using order as an address', () => {
    expect(buildPackageRows({
      packages: [
        {
          packagePath: '../../../Game/Pak.uasset',
          offset: 0x123456789ABCDEFn,
          order: 99,
        },
        {
          packagePath: '../../../Game/IoStore.uasset',
          firstOffset: 0xFEDCBA987654321n,
          order: 3,
        },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/IoStore.uasset',
        physicalOffset: 0xFEDCBA987654321n,
      }),
      expect.objectContaining({
        id: '../../../Game/Pak.uasset',
        physicalOffset: 0x123456789ABCDEFn,
      }),
    ]);
  });
```

Replace the old order fallback tests:

```ts
  test('falls back to physicalOrder when order is blank', () => {
```

and:

```ts
  test('preserves zero physical order values from order', () => {
```

with:

```ts
  test('falls back through alternate physical offset fields', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '../../../Game/Offset.uasset', offset: '', physicalOffset: 0x44n },
        { packagePath: '../../../Game/Snake.uasset', physical_offset: '0x55' },
        { packagePath: '../../../Game/FirstSnake.uasset', first_offset: '1024' },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/FirstSnake.uasset',
        physicalOffset: 1024n,
      }),
      expect.objectContaining({
        id: '../../../Game/Offset.uasset',
        physicalOffset: 0x44n,
      }),
      expect.objectContaining({
        id: '../../../Game/Snake.uasset',
        physicalOffset: 0x55n,
      }),
    ]);
  });

  test('does not treat order as a physical offset', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '../../../Game/OrderOnly.uasset', order: 0 },
      ],
    })).toEqual([
      expect.not.objectContaining({
        physicalOffset: 0,
      }),
    ]);
  });
```

Replace the package comparator rows and tests with:

```ts
describe('package row comparators', () => {
  const rows: PackageRow[] = [
    { id: 'b', fullPath: '/Game/Beta.uasset', fileName: 'Beta.uasset', physicalOffset: 0x2000n, source: {} },
    { id: 'a', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOffset: 0x1000n, source: {} },
    { id: 'c', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOffset: undefined, source: {} },
  ];

  test('comparePackageFileName sorts by basename with stable path tie-breaks', () => {
    expect([...rows].sort(comparePackageFileName).map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  test('comparePackageOffset sorts known physical offsets before unknown offsets', () => {
    expect([...rows].sort(comparePackageOffset).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 6: Run view-model tests and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

Expected: FAIL because `physicalOffset` and `comparePackageOffset` are not implemented.

- [ ] **Step 7: Implement physical offset normalization**

In `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`, change `PackageRow`:

```ts
  physicalOffset?: number | bigint;
```

Remove `physicalOrder?: number;` from `PackageRow`.

Add these helpers after `firstFiniteNumber`:

```ts
function toPhysicalOffset(value: unknown): number | bigint | undefined {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }

    try {
      const parsed = BigInt(trimmed);
      return parsed >= 0n ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function firstPhysicalOffset(values: unknown[]): number | bigint | undefined {
  for (const value of values) {
    const offset = toPhysicalOffset(value);
    if (offset !== undefined) {
      return offset;
    }
  }

  return undefined;
}

function comparePhysicalOffsetValue(left: number | bigint, right: number | bigint): number {
  const leftOffset = typeof left === 'bigint' ? left : BigInt(Math.trunc(left));
  const rightOffset = typeof right === 'bigint' ? right : BigInt(Math.trunc(right));

  if (leftOffset < rightOffset) {
    return -1;
  }

  if (leftOffset > rightOffset) {
    return 1;
  }

  return 0;
}
```

Replace `comparePackageOrder` with:

```ts
export function comparePackageOffset(left: PackageRow, right: PackageRow): number {
  const leftOffset = left.physicalOffset;
  const rightOffset = right.physicalOffset;
  const leftHasOffset = leftOffset !== undefined;
  const rightHasOffset = rightOffset !== undefined;

  if (leftHasOffset && rightHasOffset) {
    const offsetComparison = comparePhysicalOffsetValue(leftOffset, rightOffset);
    if (offsetComparison !== 0) {
      return offsetComparison;
    }
  }

  if (leftHasOffset !== rightHasOffset) {
    return leftHasOffset ? -1 : 1;
  }

  return comparePackageFileName(left, right);
}
```

Replace the `physicalOrder` normalization in `buildPackageRows`:

```ts
    const physicalOffset = firstPhysicalOffset([
      packageEntry.offset,
      packageEntry.physicalOffset,
      packageEntry.physical_offset,
      packageEntry.firstOffset,
      packageEntry.first_offset,
    ]);
```

and set the row field:

```ts
    if (physicalOffset !== undefined) {
      row.physicalOffset = physicalOffset;
    }
```

- [ ] **Step 8: Run view-model tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run utility tests together and commit**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/format.test.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

Expected: PASS.

Commit:

```powershell
git add -- node-shell/apps/desktop/renderer-src/src/utils/format.ts node-shell/apps/desktop/renderer-src/src/utils/format.test.ts node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
git commit -m "Normalize package physical offsets"
```

---

## Task 4: Display Physical Offsets In Packages And Details UI

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`

- [ ] **Step 1: Update failing PackageTable tests**

In `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`, replace all `physicalOrder` test row fields with `physicalOffset`.

Change the expected column contract to:

```ts
      { dataIndex: 'physicalOffset', key: 'physicalOffset', title: 'Offset', width: 170 },
```

Change the sorter assertion:

```ts
    expect(columnByKey('physicalOffset').sorter).toEqual(expect.any(Function));
```

In the numeric sorter test, keep `size` and `compressedSize`, then add a dedicated offset sorter assertion:

```ts
    (['size', 'compressedSize'] as const).forEach((key) => {
      const sorter = sorterByKey(key);
      expect(sorter(low, high)).toBeLessThan(0);
      expect(sorter(high, low)).toBeGreaterThan(0);
      expect(sorter(low, missing)).toBeLessThan(0);
      expect(sorter(missing, low)).toBeGreaterThan(0);
      expect(sorter(alphaTie, low)).toBeLessThan(0);
    });

    const offsetSorter = sorterByKey('physicalOffset');
    expect(offsetSorter(
      packageRow({ id: 'low-offset', fileName: 'LowOffset.uasset', physicalOffset: 0x10n }),
      packageRow({ id: 'high-offset', fileName: 'HighOffset.uasset', physicalOffset: 0x20n }),
    )).toBeLessThan(0);
    expect(offsetSorter(
      packageRow({ id: 'known-offset', fileName: 'KnownOffset.uasset', physicalOffset: 0x10n }),
      packageRow({ id: 'missing-offset', fileName: 'MissingOffset.uasset' }),
    )).toBeLessThan(0);
```

Replace the rendering test with:

```ts
  test('renders package paths, byte counts, and fixed-width hex offsets', () => {
    render(<PackageTable rows={rows} height={320} onSelectPackage={() => {}} />);

    expect(renderColumnText(columnByKey('size'), 3000, rows[0])).toBe('2.93 KB');
    expect(renderColumnText(columnByKey('compressedSize'), 1200, rows[0])).toBe('1.17 KB');
    expect(renderColumnText(columnByKey('physicalOffset'), 0x123456789ABCDEFn, packageRow({
      id: 'offset',
      fileName: 'Offset.uasset',
      physicalOffset: 0x123456789ABCDEFn,
    }))).toBe('0x0123456789ABCDEF');
    expect(renderColumnText(columnByKey('physicalOffset'), undefined, packageRow({
      id: 'missing-offset',
      fileName: 'MissingOffset.uasset',
    }))).toBe('');
  });
```

- [ ] **Step 2: Run PackageTable test and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx
```

Expected: FAIL because the component still displays `Order`.

- [ ] **Step 3: Implement Offset column in PackageTable**

In `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`, update imports:

```ts
import {
  comparePackageFileName,
  comparePackageOffset,
  type PackageRow,
} from '../utils/analysisViewModel';
import { formatHexOffset } from '../utils/format';
```

Change `compareNumericField` to only accept byte fields:

```ts
function compareNumericField(field: 'size' | 'compressedSize') {
```

Replace the `physicalOrder` column with:

```ts
  {
    dataIndex: 'physicalOffset',
    key: 'physicalOffset',
    title: 'Offset',
    width: 170,
    sorter: comparePackageOffset,
    render: (physicalOffset: PackageRow['physicalOffset']) => formatHexOffset(physicalOffset),
  },
```

- [ ] **Step 4: Run PackageTable test and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Update failing DetailsPane tests**

In `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`, change the package detail test:

```tsx
    render(<DetailsPane selection={packageSelection({ physicalOffset: 0x123456789ABCDEFn })} />);
```

Change the expectations:

```ts
    expect(details).toHaveTextContent('Offset');
    expect(details).toHaveTextContent('0x0123456789ABCDEF');
    expect(details).not.toHaveTextContent('Order');
```

- [ ] **Step 6: Run DetailsPane test and verify RED**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/DetailsPane.test.tsx
```

Expected: FAIL because the details pane still displays `Order`.

- [ ] **Step 7: Implement Offset detail row**

In `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`, import the formatter:

```ts
import { formatHexOffset } from '../utils/format';
```

Update `hasDetailValue` to accept `bigint`:

```ts
  if (typeof value === 'bigint') {
    return value >= 0n;
  }
```

Replace the package detail row:

```ts
      { label: 'Offset', value: formatHexOffset(row.physicalOffset) },
```

- [ ] **Step 8: Run DetailsPane test and verify GREEN**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/DetailsPane.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Update remaining renderer tests that still construct `physicalOrder` rows**

Replace `physicalOrder` with `physicalOffset` in these test files:

- `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx`
- `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
- `node-shell/apps/desktop/renderer-src/src/App.test.tsx`

Use `physicalOffset: 0n` where the old value was `physicalOrder: 0`, and `physicalOffset: 7n` where the old value was `physicalOrder: 7`.

- [ ] **Step 10: Run focused UI tests and commit**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx apps/desktop/renderer-src/src/components/DetailsPane.test.tsx apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add -- node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx
git commit -m "Display package physical offsets"
```

---

## Task 5: Update Electron GUI Smoke And Run Final Verification

**Files:**
- Modify: `node-shell/apps/desktop/test/electron-gui-smoke.test.js`

- [ ] **Step 1: Add smoke assertions for Packages action and preload API**

In `node-shell/apps/desktop/test/electron-gui-smoke.test.js`, after the visible text assertions, click the Packages tab and assert the extract action renders:

```js
  await evaluate(client, `
    Array.from(document.querySelectorAll('[role="tab"]'))
      .find((node) => node.textContent.includes('Packages'))
      ?.click();
    true;
  `);
  await waitFor(client, 'document.body.innerText.includes("Extract to...")');
  assert.equal(await evaluate(client, 'document.body.innerText.includes("Extract to...")'), true);
```

Add a preload assertion:

```js
  assert.equal(await evaluate(client, 'typeof window.upi.selectExtractOutputDirectory === "function"'), true);
```

Keep the existing assertion:

```js
  assert.equal(await evaluate(client, 'typeof window.upi === "object" && window.upi !== null'), true);
```

- [ ] **Step 2: Run the smoke test without rebuilding and verify RED or explain current state**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

Expected before rebuilding: this can fail if renderer dist is stale. Continue to the build-and-smoke step; the required completion evidence is the fresh build smoke.

- [ ] **Step 3: Build renderer and run fresh Electron smoke**

Run:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

Expected:

- Electron launches.
- Renderer reports no runtime exceptions.
- `#root` has mounted content.
- Visible UI text includes `Overview`, `Packages`, `Issues`, `Opened containers`, `Details`, and `Extract to...` after the Packages tab is selected.
- `window.upi` exists.
- `window.upi.selectExtractOutputDirectory` is a function.

- [ ] **Step 4: Run the full node-shell test suite**

Run:

```powershell
npm.cmd --prefix node-shell test
```

Expected: PASS.

- [ ] **Step 5: Review worktree scope before committing**

Run:

```powershell
git status --short
```

Expected: changed files are only the files intentionally modified by this plan plus pre-existing unrelated changes:

- pre-existing `node-shell/native/win32-x64/ue-5.8.0/debug/UnrealPackageInsightBackend.dll`
- pre-existing `node-shell/native/win32-x64/ue-5.8.0/development/UnrealPackageInsightBackend.dll`
- pre-existing `node-shell/package.json`
- pre-existing `node-shell/package-lock.json`
- pre-existing `node-shell/Engine/`

Do not stage those pre-existing unrelated files for this task.

- [ ] **Step 6: Commit smoke update**

Commit only the smoke test file:

```powershell
git add -- node-shell/apps/desktop/test/electron-gui-smoke.test.js
git commit -m "Verify extract modal and offset GUI behavior"
```

---

## Final Verification Checklist

- [ ] `npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/main-ipc.test.js` passed.
- [ ] Focused renderer Vitest command passed.
- [ ] `npm.cmd --prefix node-shell run build:renderer` passed.
- [ ] Fresh Electron GUI smoke passed.
- [ ] `npm.cmd --prefix node-shell test` passed.
- [ ] No native backend files were modified for this GUI-only change.
- [ ] No pre-existing unrelated package, DLL, or `node-shell/Engine/` changes were staged.
- [ ] All implementation commits are scoped to this feature.
