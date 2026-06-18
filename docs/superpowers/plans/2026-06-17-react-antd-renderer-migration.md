# React Ant Design Renderer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla Electron renderer with a React, TypeScript, Zustand, Rsbuild, and Ant Design renderer that supports virtualized package trees and virtualized analysis tables.

**Architecture:** Keep the Electron main and preload IPC boundary stable. Build a React renderer under `node-shell/apps/desktop/renderer-src`, load the built output from Electron, and move UI workflows into typed Zustand actions plus focused React components. Use Ant Design Tree and Table virtual scrolling instead of a custom virtual list engine.

**Tech Stack:** Electron, React, TypeScript, Rsbuild, Ant Design, Zustand, Vitest, Testing Library.

---

## File Structure

- Modify `node-shell/package.json`: add renderer build/test scripts and UI dependencies.
- Modify `node-shell/package-lock.json`: update through `npm install`.
- Create `node-shell/apps/desktop/rsbuild.config.ts`: renderer build configuration.
- Create `node-shell/apps/desktop/vitest.config.ts`: jsdom renderer test configuration.
- Create `node-shell/apps/desktop/renderer-src/index.html`: renderer HTML template.
- Create `node-shell/apps/desktop/renderer-src/src/main.tsx`: React entry point.
- Create `node-shell/apps/desktop/renderer-src/src/App.tsx`: high-level shell layout.
- Create `node-shell/apps/desktop/renderer-src/src/styles.css`: dense desktop shell sizing and Ant Design overrides.
- Create `node-shell/apps/desktop/renderer-src/src/types/upi.ts`: typed scan, issue, backend, and analysis models.
- Create `node-shell/apps/desktop/renderer-src/src/ipc/upiClient.ts`: typed wrapper around `window.upi`.
- Create `node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`: renderer global `window.upi` declaration.
- Create `node-shell/apps/desktop/renderer-src/src/utils/format.ts`: label and value formatting.
- Create `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts`: result-to-tab model conversion.
- Create `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts`: scan tree to Ant Design tree data mapping.
- Create `node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx`: virtualized package tree component.
- Create `node-shell/apps/desktop/renderer-src/src/components/analysisTableData.ts`: table columns, rows, and row keys.
- Create `node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.tsx`: virtualized Ant Design table wrapper.
- Create `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`: tabs for overview, packages, chunks, blocks, partitions, and issues.
- Create `node-shell/apps/desktop/renderer-src/src/components/AesKeyDialog.tsx`: AES prompt.
- Create `node-shell/apps/desktop/renderer-src/src/components/BackendChooserDialog.tsx`: backend choice prompt.
- Create `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`: vanilla Zustand store factory and async actions.
- Create `node-shell/apps/desktop/renderer-src/src/stores/useAppStore.ts`: React hook binding for the vanilla store.
- Create renderer tests beside source files with `*.test.ts` or `*.test.tsx`.
- Modify `node-shell/apps/desktop/main.js`: load the built renderer output.
- Modify `node-shell/apps/desktop/test/main-ipc.test.js`: assert the new built renderer path.
- Modify `node-shell/apps/desktop/test/renderer-static.test.js`: assert React source/build configuration instead of old script tags.
- Remove `node-shell/apps/desktop/test/renderer-behavior.test.js` after store/component tests cover those behaviors.
- Delete old files under `node-shell/apps/desktop/renderer/` after Electron loads the built React renderer.
- Modify `.gitignore`: ignore `node-shell/apps/desktop/renderer-dist/`.

---

### Task 1: Add Renderer Build And Test Tooling

**Files:**
- Modify: `node-shell/test/package-scripts.test.js`
- Modify: `node-shell/package.json`
- Modify: `node-shell/package-lock.json`
- Create: `node-shell/apps/desktop/rsbuild.config.ts`
- Create: `node-shell/apps/desktop/vitest.config.ts`
- Create: `node-shell/apps/desktop/renderer-src/index.html`
- Create: `node-shell/apps/desktop/renderer-src/src/main.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Write the failing package script test**

Add this test to `node-shell/test/package-scripts.test.js`:

```js
test('node-shell exposes renderer build and renderer test scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['test:node'], 'node --test "test/*.test.js" "packages/protocol/test/*.test.js" "packages/backend-core/test/*.test.js" "packages/analysis-domain/test/*.test.js" "apps/desktop/test/*.test.js"');
  assert.equal(pkg.scripts['test:renderer'], 'vitest run --config apps/desktop/vitest.config.ts');
  assert.equal(pkg.scripts.test, 'npm run test:node && npm run test:renderer');
  assert.equal(pkg.scripts['build:renderer'], 'rsbuild build --config apps/desktop/rsbuild.config.ts');
  assert.equal(pkg.scripts.gui, 'npm run build:renderer && node bin/upi-gui.js');
});
```

- [ ] **Step 2: Run the package script test and verify it fails**

Run:

```bash
npm --prefix node-shell test -- --test-name-pattern "renderer build"
```

Expected: FAIL because `test:node`, `test:renderer`, and `build:renderer` are missing or `test` still points directly at `node --test`.

- [ ] **Step 3: Install renderer dependencies**

Run:

```bash
npm --prefix node-shell install react react-dom antd zustand @rsbuild/core @rsbuild/plugin-react
npm --prefix node-shell install --save-dev typescript @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Expected: `node-shell/package.json` and `node-shell/package-lock.json` update with the listed dependencies.

- [ ] **Step 4: Update `node-shell/package.json` scripts**

Ensure the `scripts` object contains:

```json
{
  "test": "npm run test:node && npm run test:renderer",
  "test:node": "node --test \"test/*.test.js\" \"packages/protocol/test/*.test.js\" \"packages/backend-core/test/*.test.js\" \"packages/analysis-domain/test/*.test.js\" \"apps/desktop/test/*.test.js\"",
  "test:renderer": "vitest run --config apps/desktop/vitest.config.ts",
  "build:renderer": "rsbuild build --config apps/desktop/rsbuild.config.ts",
  "call-backend": "node src/index.js",
  "generate-protocol": "node ../scripts/generate-protocol.js",
  "gui": "npm run build:renderer && node bin/upi-gui.js",
  "cli": "node bin/upi-cli.js"
}
```

- [ ] **Step 5: Create `node-shell/apps/desktop/rsbuild.config.ts`**

```ts
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: path.resolve(__dirname, 'renderer-src/src/main.tsx'),
    },
  },
  html: {
    template: path.resolve(__dirname, 'renderer-src/index.html'),
  },
  output: {
    distPath: {
      root: path.resolve(__dirname, 'renderer-dist'),
    },
    cleanDistPath: true,
  },
  tools: {
    rspack: {
      target: 'electron-renderer',
    },
  },
});
```

- [ ] **Step 6: Create `node-shell/apps/desktop/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['apps/desktop/renderer-src/src/**/*.test.{ts,tsx}'],
    setupFiles: ['apps/desktop/renderer-src/src/test/setup.ts'],
  },
});
```

- [ ] **Step 7: Create the initial React renderer files**

`node-shell/apps/desktop/renderer-src/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UnrealPackageInsight</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

`node-shell/apps/desktop/renderer-src/src/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`node-shell/apps/desktop/renderer-src/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="app-shell">
      <section className="app-bootstrap">UnrealPackageInsight</section>
    </main>
  );
}
```

`node-shell/apps/desktop/renderer-src/src/styles.css`:

```css
html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  font-family: "Segoe UI", system-ui, sans-serif;
}

.app-shell {
  display: grid;
  min-width: 760px;
  height: 100vh;
}

.app-bootstrap {
  display: grid;
  place-items: center;
  color: #4b5563;
}
```

- [ ] **Step 8: Run the package script test and renderer build**

Run:

```bash
npm --prefix node-shell run test:node -- --test-name-pattern "renderer build"
npm --prefix node-shell run build:renderer
```

Expected: package script test PASS. Renderer build exits 0 and creates `node-shell/apps/desktop/renderer-dist/index.html`.

- [ ] **Step 9: Commit**

```bash
git add node-shell/package.json node-shell/package-lock.json node-shell/test/package-scripts.test.js node-shell/apps/desktop/rsbuild.config.ts node-shell/apps/desktop/vitest.config.ts node-shell/apps/desktop/renderer-src
git commit -m "build: add react renderer toolchain"
```

---

### Task 2: Add Typed IPC Client And Formatting Utilities

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/test/setup.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/types/upi.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/ipc/upiClient.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/utils/format.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/utils/format.test.ts`

- [ ] **Step 1: Create Vitest setup**

`node-shell/apps/desktop/renderer-src/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Write failing format tests**

`node-shell/apps/desktop/renderer-src/src/utils/format.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatLabel, formatValue } from './format';

describe('formatLabel', () => {
  test('converts camel case and underscores into title text', () => {
    expect(formatLabel('compressedBlockCount')).toBe('Compressed Block Count');
    expect(formatLabel('aes_key_required')).toBe('Aes Key Required');
  });
});

describe('formatValue', () => {
  test('matches renderer value formatting for nullish and object values', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('');
    expect(formatValue({ path: 'C:\\Paks\\A.pak', size: 12n })).toBe('{"path":"C:\\\\Paks\\\\A.pak","size":"12"}');
  });
});
```

- [ ] **Step 3: Run format tests and verify they fail**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/utils/format.test.ts
```

Expected: FAIL because `format.ts` does not exist.

- [ ] **Step 4: Add shared renderer types**

`node-shell/apps/desktop/renderer-src/src/types/upi.ts`:

```ts
export type Issue = {
  severity?: string;
  code?: string;
  message?: string;
};

export type BackendInfo = {
  status?: string;
  backendName?: string;
  backendVersion?: string;
  unrealVersion?: string;
  protocolVersion?: string;
  backendCount?: number;
  backends?: Array<{ id: string; label: string }>;
  issues?: Issue[];
};

export type PackageTreeNode = {
  name?: string;
  path?: string;
  kind?: 'directory' | 'pak' | 'utoc' | 'ucas' | string;
  relativePath?: string;
  children?: PackageTreeNode[];
};

export type PackageFile = {
  path: string;
  name?: string;
  extension?: string;
  kind?: string;
  relativePath?: string;
};

export type PackageScan = {
  root: string;
  files: PackageFile[];
  tree: PackageTreeNode;
};

export type BackendSelectionCandidate = {
  id: string;
  label: string;
};

export type BackendSelectionRequest = {
  filePath?: string;
  containerLabel?: string;
  probe?: Record<string, unknown>;
  candidates?: BackendSelectionCandidate[];
  selectedId?: string;
};

export type AnalysisResult = {
  status?: string;
  issues?: Issue[];
  overview?: Record<string, unknown>;
  packages?: unknown[];
  chunks?: unknown[];
  compressedBlocks?: unknown[];
  partitions?: unknown[];
  backendSelection?: BackendSelectionRequest;
  [key: string]: unknown;
};

export type UpiClient = {
  getBackendInfo(): Promise<BackendInfo>;
  openPackageDirectory(): Promise<PackageScan | null>;
  analyze(filePath: string): Promise<AnalysisResult>;
  submitAesKeyAndRetry(filePath: string, aesKey: string): Promise<AnalysisResult>;
  clearAesKey(): Promise<boolean>;
  chooseBackend(request: BackendSelectionRequest): Promise<string>;
};
```

- [ ] **Step 5: Add the global preload API declaration**

`node-shell/apps/desktop/renderer-src/src/ipc/global.d.ts`:

```ts
import type { UpiClient } from '../types/upi';

declare global {
  interface Window {
    upi: UpiClient;
  }
}

export {};
```

- [ ] **Step 6: Add the typed IPC client wrapper**

`node-shell/apps/desktop/renderer-src/src/ipc/upiClient.ts`:

```ts
import type { UpiClient } from '../types/upi';

export function getUpiClient(): UpiClient {
  if (!window.upi) {
    throw new Error('UPI preload API is unavailable.');
  }
  return window.upi;
}
```

- [ ] **Step 7: Add formatting utilities**

`node-shell/apps/desktop/renderer-src/src/utils/format.ts`:

```ts
export function formatLabel(value: string): string {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_key, nestedValue) => (
        typeof nestedValue === 'bigint' ? String(nestedValue) : nestedValue
      ));
    } catch {
      return String(value);
    }
  }
  return String(value);
}
```

- [ ] **Step 8: Run renderer tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/utils/format.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/test node-shell/apps/desktop/renderer-src/src/types node-shell/apps/desktop/renderer-src/src/ipc node-shell/apps/desktop/renderer-src/src/utils
git commit -m "feat: add typed renderer ipc utilities"
```

---

### Task 3: Add Testable Zustand Store Workflows

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/stores/useAppStore.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`

- [ ] **Step 1: Write failing store tests**

`node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`:

```ts
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
    const store = createAppStore(createClient({
      analyze: (filePath) => {
        calls.push(filePath);
        return calls.length === 1
          ? first
          : Promise.resolve({ status: 'OK', overview: { selected: 'B' }, packages: [], compressedBlocks: [] });
      },
    }));

    const firstRun = store.getState().analyzeFile('C:\\Paks\\A.pak');
    await store.getState().analyzeFile('C:\\Paks\\B.pak');
    resolveFirst({ status: 'OK', overview: { selected: 'A' }, packages: [], compressedBlocks: [] });
    await firstRun;

    expect(store.getState().selectedFilePath).toBe('C:\\Paks\\B.pak');
    expect(store.getState().analysisResult?.overview).toEqual({ selected: 'B' });
  });
});
```

- [ ] **Step 2: Run store tests and verify they fail**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: FAIL because `appStore.ts` does not exist.

- [ ] **Step 3: Add the Zustand store factory**

`node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`:

```ts
import { createStore } from 'zustand/vanilla';
import type {
  AnalysisResult,
  BackendInfo,
  BackendSelectionRequest,
  PackageScan,
  UpiClient,
} from '../types/upi';

type DialogState = {
  aesFilePath: string;
  aesMessage: string;
  backendSelection: BackendSelectionRequest | null;
};

export type AppState = {
  backendInfo: BackendInfo | null;
  scan: PackageScan | null;
  selectedFilePath: string;
  analysisResult: AnalysisResult | null;
  statusText: string;
  isOpeningDirectory: boolean;
  isAnalyzing: boolean;
  analysisRequestId: number;
  dialog: DialogState;
  loadBackendInfo(): Promise<void>;
  openDirectory(): Promise<void>;
  analyzeFile(filePath: string): Promise<void>;
  submitAesKey(aesKey: string): Promise<void>;
  cancelAesDialog(): void;
  chooseBackend(selectedId: string): Promise<void>;
  cancelBackendDialog(): void;
};

function formatScanStatus(scan: PackageScan): string {
  const count = Array.isArray(scan.files) ? scan.files.length : 0;
  return count === 1 ? '1 file found' : `${count} files found`;
}

function hasIssues(result: AnalysisResult | BackendInfo | null): boolean {
  return Array.isArray(result?.issues) && result.issues.length > 0;
}

function hasAesRetryIssue(result: AnalysisResult): boolean {
  return Boolean(result.issues?.some((issue) => {
    const code = String(issue.code || '');
    return code === 'aes.invalid_key'
      || code.endsWith('.aes_key_invalid')
      || code.endsWith('.aes_key_required');
  }));
}

function firstIssueMessage(result: AnalysisResult, fallback: string): string {
  return result.issues?.[0]?.message || fallback;
}

function errorResult(code: string, error: unknown): AnalysisResult {
  return {
    status: 'Error',
    issues: [{
      severity: 'error',
      code,
      message: error instanceof Error ? error.message : String(error || 'Unknown error'),
    }],
  };
}

export function createAppStore(client: UpiClient) {
  return createStore<AppState>((set, get) => ({
    backendInfo: null,
    scan: null,
    selectedFilePath: '',
    analysisResult: null,
    statusText: 'Idle',
    isOpeningDirectory: false,
    isAnalyzing: false,
    analysisRequestId: 0,
    dialog: {
      aesFilePath: '',
      aesMessage: 'Enter the key for this container and analyze again.',
      backendSelection: null,
    },

    async loadBackendInfo() {
      set({ statusText: 'Loading backend...' });
      try {
        const backendInfo = await client.getBackendInfo();
        set({ backendInfo, statusText: hasIssues(backendInfo) ? 'Backend issue' : 'Ready' });
      } catch (error) {
        set({
          backendInfo: errorResult('renderer.backend_info_failed', error),
          analysisResult: errorResult('renderer.backend_info_failed', error),
          statusText: 'Backend error',
        });
      }
    },

    async openDirectory() {
      set({ isOpeningDirectory: true, statusText: 'Opening...' });
      try {
        const scan = await client.openPackageDirectory();
        if (!scan) {
          set({ statusText: 'Open canceled' });
          return;
        }
        set({
          scan,
          selectedFilePath: '',
          analysisResult: null,
          statusText: formatScanStatus(scan),
          dialog: { aesFilePath: '', aesMessage: 'Enter the key for this container and analyze again.', backendSelection: null },
        });
      } catch (error) {
        set({ analysisResult: errorResult('renderer.open_failed', error), statusText: 'Open failed' });
      } finally {
        set({ isOpeningDirectory: false });
      }
    },

    async analyzeFile(filePath: string) {
      const requestId = get().analysisRequestId + 1;
      set({
        selectedFilePath: filePath,
        analysisRequestId: requestId,
        analysisResult: null,
        isAnalyzing: true,
        statusText: 'Analyzing...',
        dialog: { ...get().dialog, aesFilePath: '' },
      });
      try {
        const result = await client.analyze(filePath);
        if (get().analysisRequestId !== requestId || get().selectedFilePath !== filePath) {
          return;
        }
        if (result.backendSelection) {
          set({
            analysisResult: result,
            statusText: 'Choose backend',
            dialog: { ...get().dialog, backendSelection: result.backendSelection },
          });
          return;
        }
        if (hasAesRetryIssue(result)) {
          set({
            analysisResult: result,
            statusText: String(result.issues?.[0]?.code || '').endsWith('.aes_key_required') ? 'AES key required' : 'AES key invalid',
            dialog: {
              ...get().dialog,
              aesFilePath: filePath,
              aesMessage: firstIssueMessage(result, 'AES key required.'),
            },
          });
          return;
        }
        set({ analysisResult: result, statusText: 'Analysis ready' });
      } catch (error) {
        if (get().analysisRequestId === requestId && get().selectedFilePath === filePath) {
          set({ analysisResult: errorResult('renderer.analysis_failed', error), statusText: 'Analysis failed' });
        }
      } finally {
        if (get().analysisRequestId === requestId) {
          set({ isAnalyzing: false });
        }
      }
    },

    async submitAesKey(aesKey: string) {
      const filePath = get().dialog.aesFilePath;
      if (!filePath) {
        return;
      }
      set({ statusText: 'Retrying analysis...', isAnalyzing: true });
      try {
        const result = await client.submitAesKeyAndRetry(filePath, aesKey.trim());
        if (get().selectedFilePath !== filePath) {
          return;
        }
        if (hasAesRetryIssue(result)) {
          set({
            analysisResult: result,
            statusText: String(result.issues?.[0]?.code || '').endsWith('.aes_key_required') ? 'AES key required' : 'AES key invalid',
            dialog: { ...get().dialog, aesMessage: firstIssueMessage(result, 'Invalid AES key.') },
          });
          return;
        }
        set({
          analysisResult: result,
          statusText: 'Analysis ready',
          dialog: { ...get().dialog, aesFilePath: '' },
        });
      } catch (error) {
        if (get().selectedFilePath === filePath) {
          set({
            analysisResult: errorResult('renderer.aes_retry_failed', error),
            statusText: 'AES retry failed',
            dialog: { ...get().dialog, aesFilePath: '' },
          });
        }
      } finally {
        set({ isAnalyzing: false });
      }
    },

    cancelAesDialog() {
      set({ dialog: { ...get().dialog, aesFilePath: '' } });
    },

    async chooseBackend(selectedId: string) {
      const backendSelection = get().dialog.backendSelection;
      if (!backendSelection) {
        return;
      }
      const result = await client.chooseBackend({ ...backendSelection, selectedId });
      set({ dialog: { ...get().dialog, backendSelection: null } });
      if (result && backendSelection.filePath) {
        await get().analyzeFile(backendSelection.filePath);
      } else {
        set({ statusText: 'Backend selection canceled' });
      }
    },

    cancelBackendDialog() {
      const backendSelection = get().dialog.backendSelection;
      set({ dialog: { ...get().dialog, backendSelection: null }, statusText: 'Backend selection canceled' });
      if (backendSelection) {
        void client.chooseBackend({ ...backendSelection, selectedId: '' });
      }
    },
  }));
}
```

- [ ] **Step 4: Add the React hook binding**

`node-shell/apps/desktop/renderer-src/src/stores/useAppStore.ts`:

```ts
import { useStore } from 'zustand';
import { getUpiClient } from '../ipc/upiClient';
import { createAppStore } from './appStore';

export const appStore = createAppStore(getUpiClient());

export function useAppStore<T>(selector: (state: ReturnType<typeof appStore.getState>) => T): T {
  return useStore(appStore, selector);
}
```

- [ ] **Step 5: Run store tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/stores
git commit -m "feat: add renderer app store"
```

---

### Task 4: Add Virtualized Package Tree

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageTree.test.tsx`

- [ ] **Step 1: Write failing tree data tests**

`node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { toAntTreeData, supportedFileKeys } from './packageTreeData';
import type { PackageTreeNode } from '../types/upi';

const scanTree: PackageTreeNode = {
  name: 'Paks',
  path: 'C:\\Paks',
  kind: 'directory',
  children: [
    { name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak', relativePath: 'A.pak' },
    { name: 'Nested', path: 'C:\\Paks\\Nested', kind: 'directory', children: [
      { name: 'global.utoc', path: 'C:\\Paks\\Nested\\global.utoc', kind: 'utoc', relativePath: 'Nested\\global.utoc' },
    ] },
  ],
};

describe('packageTreeData', () => {
  test('maps scan tree nodes to Ant Design tree data with stable keys', () => {
    expect(toAntTreeData(scanTree)).toEqual([{
      key: 'C:\\Paks',
      title: 'Paks',
      selectable: false,
      children: [
        { key: 'C:\\Paks\\A.pak', title: 'A.pak', selectable: true, children: undefined },
        {
          key: 'C:\\Paks\\Nested',
          title: 'Nested',
          selectable: false,
          children: [
            { key: 'C:\\Paks\\Nested\\global.utoc', title: 'global.utoc', selectable: true, children: undefined },
          ],
        },
      ],
    }]);
  });

  test('collects only supported file keys', () => {
    expect(supportedFileKeys(scanTree)).toEqual([
      'C:\\Paks\\A.pak',
      'C:\\Paks\\Nested\\global.utoc',
    ]);
  });
});
```

- [ ] **Step 2: Run tree data tests and verify they fail**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/packageTreeData.test.ts
```

Expected: FAIL because `packageTreeData.ts` does not exist.

- [ ] **Step 3: Implement package tree data mapping**

`node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts`:

```ts
import type { DataNode } from 'antd/es/tree';
import type { PackageTreeNode } from '../types/upi';

const SUPPORTED_KINDS = new Set(['pak', 'utoc', 'ucas']);

export function isSupportedFileNode(node: PackageTreeNode): boolean {
  return SUPPORTED_KINDS.has(String(node.kind || ''));
}

export function nodeKey(node: PackageTreeNode): string {
  return node.path || node.relativePath || node.name || 'unnamed';
}

export function toAntTreeData(root: PackageTreeNode | null | undefined): DataNode[] {
  if (!root) {
    return [];
  }
  return [toAntNode(root)];
}

function toAntNode(node: PackageTreeNode): DataNode {
  const children = Array.isArray(node.children) && node.children.length > 0
    ? node.children.map(toAntNode)
    : undefined;

  return {
    key: nodeKey(node),
    title: node.name || node.relativePath || node.path || 'Directory',
    selectable: isSupportedFileNode(node),
    children,
  };
}

export function supportedFileKeys(root: PackageTreeNode | null | undefined): string[] {
  const keys: string[] = [];
  const visit = (node: PackageTreeNode) => {
    if (isSupportedFileNode(node)) {
      keys.push(nodeKey(node));
    }
    for (const child of node.children || []) {
      visit(child);
    }
  };
  if (root) {
    visit(root);
  }
  return keys;
}
```

- [ ] **Step 4: Run tree data tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/packageTreeData.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing PackageTree component test**

`node-shell/apps/desktop/renderer-src/src/components/PackageTree.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PackageScan } from '../types/upi';
import { PackageTree } from './PackageTree';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Tree: (props: {
      height?: number;
      virtual?: boolean;
      treeData?: Array<{ key: string; title: string }>;
      onSelect?: (keys: React.Key[]) => void;
    }) => (
      <div data-testid="mock-tree" data-height={props.height} data-virtual={String(props.virtual !== false)}>
        {props.treeData?.map((node) => (
          <button key={node.key} type="button" onClick={() => props.onSelect?.([node.key])}>{node.title}</button>
        ))}
      </div>
    ),
  };
});

const scan: PackageScan = {
  root: 'C:\\Paks',
  files: [{ path: 'C:\\Paks\\A.pak', name: 'A.pak' }],
  tree: {
    name: 'Paks',
    path: 'C:\\Paks',
    kind: 'directory',
    children: [{ name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak' }],
  },
};

describe('PackageTree', () => {
  test('passes a numeric height to keep Ant Design virtual scrolling active', () => {
    render(<PackageTree scan={scan} selectedFilePath="" height={512} onSelectFile={() => {}} />);

    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-height', '512');
    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-virtual', 'true');
  });
});
```

- [ ] **Step 6: Run PackageTree test and verify it fails**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/PackageTree.test.tsx
```

Expected: FAIL because `PackageTree.tsx` does not exist.

- [ ] **Step 7: Implement PackageTree**

`node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx`:

```tsx
import { Empty, Tree } from 'antd';
import type { Key } from 'react';
import type { PackageScan } from '../types/upi';
import { supportedFileKeys, toAntTreeData } from './packageTreeData';

type PackageTreeProps = {
  scan: PackageScan | null;
  selectedFilePath: string;
  height: number;
  onSelectFile(filePath: string): void;
};

export function PackageTree({ scan, selectedFilePath, height, onSelectFile }: PackageTreeProps) {
  if (!scan?.tree || scan.files.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No supported package files found." />;
  }

  const selectableKeys = new Set(supportedFileKeys(scan.tree));
  const treeData = toAntTreeData(scan.tree);

  const handleSelect = (keys: Key[]) => {
    const key = String(keys[0] || '');
    if (selectableKeys.has(key)) {
      onSelectFile(key);
    }
  };

  return (
    <Tree
      blockNode
      defaultExpandAll
      height={height}
      selectedKeys={selectedFilePath ? [selectedFilePath] : []}
      treeData={treeData}
      virtual
      onSelect={handleSelect}
    />
  );
}
```

- [ ] **Step 8: Run tree tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/packageTreeData.test.ts apps/desktop/renderer-src/src/components/PackageTree.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx node-shell/apps/desktop/renderer-src/src/components/PackageTree.test.tsx
git commit -m "feat: add virtual package tree"
```

---

### Task 5: Add Virtualized Analysis Table

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/components/analysisTableData.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/components/analysisTableData.test.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.test.tsx`

- [ ] **Step 1: Write failing table data tests**

`node-shell/apps/desktop/renderer-src/src/components/analysisTableData.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildColumnKeys, rowKey } from './analysisTableData';

describe('analysisTableData', () => {
  test('builds ordered union columns from row object keys', () => {
    expect(buildColumnKeys([
      { name: 'A', offset: 0 },
      { size: 42, name: 'B' },
    ])).toEqual(['name', 'offset', 'size']);
  });

  test('creates stable row keys from path-like fields before index fallback', () => {
    expect(rowKey({ path: 'C:\\Paks\\A.pak' }, 7)).toBe('C:\\Paks\\A.pak');
    expect(rowKey({ name: 'chunk-1' }, 2)).toBe('chunk-1');
    expect(rowKey({ value: 12 }, 3)).toBe('row-3');
  });
});
```

- [ ] **Step 2: Run table data tests and verify they fail**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/analysisTableData.test.ts
```

Expected: FAIL because `analysisTableData.ts` does not exist.

- [ ] **Step 3: Implement table data helpers**

`node-shell/apps/desktop/renderer-src/src/components/analysisTableData.ts`:

```ts
import type { ColumnsType } from 'antd/es/table';
import { formatLabel, formatValue } from '../utils/format';

export type TableRecord = Record<string, unknown>;

export function normalizeRow(row: unknown): TableRecord {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return row as TableRecord;
  }
  return { value: row };
}

export function buildColumnKeys(rows: unknown[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(normalizeRow(row))) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }
  return columns.length > 0 ? columns : ['value'];
}

export function rowKey(row: unknown, index: number): string {
  const normalized = normalizeRow(row);
  const key = normalized.path ?? normalized.relativePath ?? normalized.name ?? normalized.id;
  return key === undefined || key === null || key === '' ? `row-${index}` : String(key);
}

export function buildColumns(rows: unknown[]): ColumnsType<TableRecord> {
  return buildColumnKeys(rows).map((key) => ({
    key,
    dataIndex: key,
    title: formatLabel(key),
    ellipsis: true,
    render: (value: unknown) => formatValue(value),
  }));
}

export function buildDataSource(rows: unknown[]): TableRecord[] {
  return rows.map((row, index) => ({
    ...normalizeRow(row),
    __rowKey: rowKey(row, index),
  }));
}
```

- [ ] **Step 4: Run table data tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/analysisTableData.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing AnalysisTable component test**

`node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AnalysisTable } from './AnalysisTable';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Table: (props: { virtual?: boolean; scroll?: { x?: number; y?: number }; dataSource?: unknown[] }) => (
      <div
        data-testid="mock-table"
        data-virtual={String(props.virtual)}
        data-scroll-x={String(props.scroll?.x)}
        data-scroll-y={String(props.scroll?.y)}
        data-row-count={String(props.dataSource?.length || 0)}
      />
    ),
  };
});

describe('AnalysisTable', () => {
  test('uses Ant Design virtual table scrolling with numeric scroll dimensions', () => {
    render(<AnalysisTable rows={[{ name: 'A' }, { name: 'B' }]} height={420} />);

    expect(screen.getByTestId('mock-table')).toHaveAttribute('data-virtual', 'true');
    expect(screen.getByTestId('mock-table')).toHaveAttribute('data-scroll-y', '420');
    expect(Number(screen.getByTestId('mock-table').getAttribute('data-scroll-x'))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run AnalysisTable test and verify it fails**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/AnalysisTable.test.tsx
```

Expected: FAIL because `AnalysisTable.tsx` does not exist.

- [ ] **Step 7: Implement AnalysisTable**

`node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.tsx`:

```tsx
import { Empty, Table } from 'antd';
import { buildColumns, buildDataSource } from './analysisTableData';

type AnalysisTableProps = {
  rows: unknown[];
  height: number;
};

export function AnalysisTable({ rows, height }: AnalysisTableProps) {
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rows to show." />;
  }

  const columns = buildColumns(rows);
  const dataSource = buildDataSource(rows);
  const scrollX = Math.max(columns.length * 180, 720);

  return (
    <Table
      bordered
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      rowKey="__rowKey"
      scroll={{ x: scrollX, y: height }}
      size="small"
      tableLayout="fixed"
      virtual
    />
  );
}
```

- [ ] **Step 8: Run table tests**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/components/analysisTableData.test.ts apps/desktop/renderer-src/src/components/AnalysisTable.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/components/analysisTableData.ts node-shell/apps/desktop/renderer-src/src/components/analysisTableData.test.ts node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTable.test.tsx
git commit -m "feat: add virtual analysis table"
```

---

### Task 6: Render Analysis Tabs And Dialogs

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/AesKeyDialog.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/BackendChooserDialog.tsx`

- [ ] **Step 1: Write failing tab model tests**

`node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildAnalysisTabs } from './analysisTabs';

describe('buildAnalysisTabs', () => {
  test('builds IoStore tabs when chunks are present', () => {
    expect(buildAnalysisTabs({ chunks: [], packages: [], compressedBlocks: [], issues: [] }).map((tab) => tab.id))
      .toEqual(['overview', 'packages', 'chunks', 'blocks', 'issues']);
  });

  test('builds Pak tabs when packages and compressed blocks are present without chunks', () => {
    expect(buildAnalysisTabs({ packages: [], compressedBlocks: [], issues: [] }).map((tab) => tab.id))
      .toEqual(['overview', 'packages', 'blocks', 'issues']);
  });
});
```

- [ ] **Step 2: Run tab model tests and verify they fail**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/utils/analysisTabs.test.ts
```

Expected: FAIL because `analysisTabs.ts` does not exist.

- [ ] **Step 3: Implement tab model builder**

`node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts`:

```ts
import type { AnalysisResult, Issue } from '../types/upi';

export type AnalysisTabModel =
  | { id: 'overview'; label: 'Overview'; kind: 'overview'; result: AnalysisResult }
  | { id: 'packages'; label: 'Packages'; kind: 'table'; rows: unknown[] }
  | { id: 'chunks'; label: 'Chunks'; kind: 'table'; rows: unknown[] }
  | { id: 'blocks'; label: 'Blocks'; kind: 'table'; rows: unknown[] }
  | { id: 'partitions'; label: 'Partitions'; kind: 'table'; rows: unknown[] }
  | { id: 'issues'; label: 'Issues'; kind: 'issues'; issues: Issue[] }
  | { id: 'raw'; label: 'Raw'; kind: 'value'; value: unknown };

export function buildAnalysisTabs(result: AnalysisResult | null): AnalysisTabModel[] {
  if (!result) {
    return [];
  }

  const isIoStore = Array.isArray(result.chunks);
  const isPak = !isIoStore && Array.isArray(result.packages) && Array.isArray(result.compressedBlocks);
  const issues = Array.isArray(result.issues) ? result.issues : [];

  if (isIoStore) {
    return [
      { id: 'overview', label: 'Overview', kind: 'overview', result },
      { id: 'packages', label: 'Packages', kind: 'table', rows: result.packages || [] },
      { id: 'chunks', label: 'Chunks', kind: 'table', rows: result.chunks || [] },
      { id: 'blocks', label: 'Blocks', kind: 'table', rows: result.compressedBlocks || [] },
      { id: 'issues', label: 'Issues', kind: 'issues', issues },
    ];
  }

  if (isPak) {
    return [
      { id: 'overview', label: 'Overview', kind: 'overview', result },
      { id: 'packages', label: 'Packages', kind: 'table', rows: result.packages || [] },
      { id: 'blocks', label: 'Blocks', kind: 'table', rows: result.compressedBlocks || [] },
      { id: 'issues', label: 'Issues', kind: 'issues', issues },
    ];
  }

  if (issues.length > 0) {
    return [{ id: 'issues', label: 'Issues', kind: 'issues', issues }];
  }

  return [{ id: 'raw', label: 'Raw', kind: 'value', value: result }];
}
```

- [ ] **Step 4: Create AnalysisTabs**

`node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`:

```tsx
import { Descriptions, Empty, Tabs, Typography } from 'antd';
import type { AnalysisResult, Issue } from '../types/upi';
import { buildAnalysisTabs } from '../utils/analysisTabs';
import { formatLabel, formatValue } from '../utils/format';
import { AnalysisTable } from './AnalysisTable';

type AnalysisTabsProps = {
  result: AnalysisResult | null;
  tableHeight: number;
};

function summaryRows(result: AnalysisResult) {
  return Object.entries(result)
    .filter(([key]) => !['issues', 'packages', 'chunks', 'compressedBlocks', 'partitions', 'backendSelection'].includes(key))
    .map(([key, value]) => ({ key, label: formatLabel(key), children: formatValue(value) }));
}

function IssuesTable({ issues, height }: { issues: Issue[]; height: number }) {
  return (
    <AnalysisTable
      height={height}
      rows={issues.map((issue) => ({
        severity: issue.severity || '',
        code: issue.code || '',
        message: issue.message || '',
      }))}
    />
  );
}

export function AnalysisTabs({ result, tableHeight }: AnalysisTabsProps) {
  const tabs = buildAnalysisTabs(result);

  if (!result || tabs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select a supported package file from the tree." />;
  }

  return (
    <Tabs
      className="analysis-tabs"
      items={tabs.map((tab) => ({
        key: tab.id,
        label: tab.label,
        children: tab.kind === 'table'
          ? <AnalysisTable rows={tab.rows} height={tableHeight} />
          : tab.kind === 'issues'
            ? <IssuesTable issues={tab.issues} height={tableHeight} />
            : tab.kind === 'overview'
              ? <Descriptions bordered column={1} size="small" items={summaryRows(tab.result)} />
              : <Typography.Paragraph>{formatValue(tab.value)}</Typography.Paragraph>,
      }))}
    />
  );
}
```

- [ ] **Step 5: Create AES key dialog**

`node-shell/apps/desktop/renderer-src/src/components/AesKeyDialog.tsx`:

```tsx
import { Form, Input, Modal } from 'antd';
import { useState } from 'react';

type AesKeyDialogProps = {
  open: boolean;
  message: string;
  loading: boolean;
  onSubmit(aesKey: string): void;
  onCancel(): void;
};

export function AesKeyDialog({ open, message, loading, onSubmit, onCancel }: AesKeyDialogProps) {
  const [aesKey, setAesKey] = useState('');

  return (
    <Modal
      confirmLoading={loading}
      okText="Analyze"
      open={open}
      title="AES key required"
      onCancel={onCancel}
      onOk={() => onSubmit(aesKey)}
    >
      <p>{message}</p>
      <Form layout="vertical">
        <Form.Item label="AES key">
          <Input.Password value={aesKey} autoComplete="off" onChange={(event) => setAesKey(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 6: Create backend chooser dialog**

`node-shell/apps/desktop/renderer-src/src/components/BackendChooserDialog.tsx`:

```tsx
import { Modal, Radio } from 'antd';
import { useEffect, useState } from 'react';
import type { BackendSelectionRequest } from '../types/upi';

type BackendChooserDialogProps = {
  request: BackendSelectionRequest | null;
  onSubmit(selectedId: string): void;
  onCancel(): void;
};

export function BackendChooserDialog({ request, onSubmit, onCancel }: BackendChooserDialogProps) {
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    setSelectedId(request?.candidates?.[0]?.id || '');
  }, [request]);

  return (
    <Modal
      okText="Use backend"
      open={Boolean(request)}
      title="Choose backend"
      onCancel={onCancel}
      onOk={() => onSubmit(selectedId)}
    >
      <p>{request?.containerLabel || 'Container'} requires a backend.</p>
      <Radio.Group value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        {(request?.candidates || []).map((candidate) => (
          <Radio key={candidate.id} value={candidate.id}>
            {candidate.label} ({candidate.id})
          </Radio>
        ))}
      </Radio.Group>
    </Modal>
  );
}
```

- [ ] **Step 7: Run tab tests and renderer build**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/utils/analysisTabs.test.ts
npm --prefix node-shell run build:renderer
```

Expected: tests PASS and build exits 0.

- [ ] **Step 8: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx node-shell/apps/desktop/renderer-src/src/components/AesKeyDialog.tsx node-shell/apps/desktop/renderer-src/src/components/BackendChooserDialog.tsx
git commit -m "feat: add renderer analysis tabs and dialogs"
```

---

### Task 7: Assemble The React Desktop Shell

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`
- Create: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`

- [ ] **Step 1: Write failing app shell test**

`node-shell/apps/desktop/renderer-src/src/App.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import App from './App';

vi.mock('./stores/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    backendInfo: { backendName: 'TestBackend', backendVersion: '1.0' },
    scan: null,
    selectedFilePath: '',
    analysisResult: null,
    statusText: 'Ready',
    isOpeningDirectory: false,
    isAnalyzing: false,
    dialog: { aesFilePath: '', aesMessage: '', backendSelection: null },
    loadBackendInfo: vi.fn(),
    openDirectory: vi.fn(),
    analyzeFile: vi.fn(),
    submitAesKey: vi.fn(),
    cancelAesDialog: vi.fn(),
    chooseBackend: vi.fn(),
    cancelBackendDialog: vi.fn(),
  }),
}));

describe('App', () => {
  test('renders the desktop shell regions', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/TestBackend/)).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run app shell test and verify it fails**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/App.test.tsx
```

Expected: FAIL because `App.tsx` still renders the bootstrap shell.

- [ ] **Step 3: Implement App shell**

Replace `node-shell/apps/desktop/renderer-src/src/App.tsx` with:

```tsx
import { Button, Layout, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { AnalysisTabs } from './components/AnalysisTabs';
import { AesKeyDialog } from './components/AesKeyDialog';
import { BackendChooserDialog } from './components/BackendChooserDialog';
import { PackageTree } from './components/PackageTree';
import { useAppStore } from './stores/useAppStore';
import type { BackendInfo } from './types/upi';

const { Header, Sider, Content } = Layout;

function backendLabel(backendInfo: BackendInfo | null): string {
  if (!backendInfo) {
    return 'Unavailable';
  }
  return [
    backendInfo.backendName,
    backendInfo.backendVersion ? `v${backendInfo.backendVersion}` : '',
    backendInfo.unrealVersion ? `UE ${backendInfo.unrealVersion}` : '',
    backendInfo.protocolVersion ? `protocol ${backendInfo.protocolVersion}` : '',
  ].filter(Boolean).join(' | ') || 'Ready';
}

export default function App() {
  const backendInfo = useAppStore((state) => state.backendInfo);
  const scan = useAppStore((state) => state.scan);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const analysisResult = useAppStore((state) => state.analysisResult);
  const statusText = useAppStore((state) => state.statusText);
  const isOpeningDirectory = useAppStore((state) => state.isOpeningDirectory);
  const isAnalyzing = useAppStore((state) => state.isAnalyzing);
  const dialog = useAppStore((state) => state.dialog);
  const loadBackendInfo = useAppStore((state) => state.loadBackendInfo);
  const openDirectory = useAppStore((state) => state.openDirectory);
  const analyzeFile = useAppStore((state) => state.analyzeFile);
  const submitAesKey = useAppStore((state) => state.submitAesKey);
  const cancelAesDialog = useAppStore((state) => state.cancelAesDialog);
  const chooseBackend = useAppStore((state) => state.chooseBackend);
  const cancelBackendDialog = useAppStore((state) => state.cancelBackendDialog);
  const [treeHeight, setTreeHeight] = useState(560);
  const [tableHeight, setTableHeight] = useState(520);

  useEffect(() => {
    void loadBackendInfo();
  }, [loadBackendInfo]);

  useEffect(() => {
    const updateHeights = () => {
      setTreeHeight(Math.max(260, window.innerHeight - 58));
      setTableHeight(Math.max(260, window.innerHeight - 176));
    };
    updateHeights();
    window.addEventListener('resize', updateHeights);
    return () => window.removeEventListener('resize', updateHeights);
  }, []);

  const backendText = useMemo(() => backendLabel(backendInfo), [backendInfo]);

  return (
    <Layout className="app-shell">
      <Sider className="sidebar" width={340} theme="light">
        <div className="toolbar">
          <Button type="primary" loading={isOpeningDirectory} onClick={() => void openDirectory()}>
            Open
          </Button>
          <Typography.Text className="status-text" ellipsis>{statusText}</Typography.Text>
        </div>
        <div className="tree-region">
          <PackageTree
            height={treeHeight}
            scan={scan}
            selectedFilePath={selectedFilePath}
            onSelectFile={(filePath) => void analyzeFile(filePath)}
          />
        </div>
      </Sider>
      <Layout>
        <Header className="analysis-header">
          <div>
            <div className="label">Backend</div>
            <Typography.Text strong ellipsis>{backendText}</Typography.Text>
          </div>
          <div>
            <div className="label">Selected file</div>
            <Typography.Text className="path-value" ellipsis>{selectedFilePath || 'None'}</Typography.Text>
          </div>
        </Header>
        <Content className="analysis-content">
          <Spin spinning={isAnalyzing}>
            <AnalysisTabs result={analysisResult} tableHeight={tableHeight} />
          </Spin>
        </Content>
      </Layout>
      <AesKeyDialog
        loading={isAnalyzing}
        message={dialog.aesMessage}
        open={Boolean(dialog.aesFilePath)}
        onCancel={cancelAesDialog}
        onSubmit={(aesKey) => void submitAesKey(aesKey)}
      />
      <BackendChooserDialog
        request={dialog.backendSelection}
        onCancel={cancelBackendDialog}
        onSubmit={(selectedId) => void chooseBackend(selectedId)}
      />
    </Layout>
  );
}
```

- [ ] **Step 4: Replace renderer CSS**

Replace `node-shell/apps/desktop/renderer-src/src/styles.css` with:

```css
html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  background: #f5f6f8;
  color: #18202b;
  font-family: "Segoe UI", system-ui, sans-serif;
}

.app-shell {
  min-width: 760px;
  height: 100vh;
}

.sidebar {
  height: 100vh;
  overflow: hidden;
  border-right: 1px solid #d6dce5;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 8px 10px;
  border-bottom: 1px solid #d6dce5;
}

.status-text {
  min-width: 0;
  max-width: 220px;
}

.tree-region {
  height: calc(100vh - 48px);
  overflow: hidden;
  padding: 6px;
}

.analysis-header {
  display: grid;
  grid-template-columns: minmax(220px, max-content) minmax(0, 1fr);
  gap: 28px;
  height: 64px;
  padding: 10px 16px;
  background: #ffffff;
  border-bottom: 1px solid #d6dce5;
  line-height: 1.45;
}

.label {
  margin-bottom: 3px;
  color: #627084;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.path-value {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
}

.analysis-content {
  min-height: 0;
  overflow: hidden;
  padding: 12px 16px 18px;
}

.analysis-tabs {
  height: calc(100vh - 94px);
}
```

- [ ] **Step 5: Run app shell test and build**

Run:

```bash
npm --prefix node-shell run test:renderer -- apps/desktop/renderer-src/src/App.test.tsx
npm --prefix node-shell run build:renderer
```

Expected: app shell test PASS and build exits 0.

- [ ] **Step 6: Commit**

```bash
git add node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "feat: assemble react desktop shell"
```

---

### Task 8: Switch Electron To The Built React Renderer

**Files:**
- Modify: `node-shell/apps/desktop/main.js`
- Modify: `node-shell/apps/desktop/test/main-ipc.test.js`
- Modify: `node-shell/apps/desktop/test/renderer-static.test.js`
- Delete: `node-shell/apps/desktop/test/renderer-behavior.test.js`
- Delete: `node-shell/apps/desktop/renderer/index.html`
- Delete: `node-shell/apps/desktop/renderer/renderer.js`
- Delete: `node-shell/apps/desktop/renderer/styles.css`
- Modify: `.gitignore`

- [ ] **Step 1: Update failing Electron load path test**

In `node-shell/apps/desktop/test/main-ipc.test.js`, update the assertion in `createWindow sets a minimum size that matches the renderer shell constraints`:

```js
assert.match(window.loadedFile, /renderer-dist[\\/]index\.html$/);
```

- [ ] **Step 2: Run the Electron main test and verify it fails**

Run:

```bash
npm --prefix node-shell run test:node -- apps/desktop/test/main-ipc.test.js --test-name-pattern "createWindow"
```

Expected: FAIL because `createWindow` still loads `renderer/index.html`.

- [ ] **Step 3: Update Electron main load path**

In `node-shell/apps/desktop/main.js`, change:

```js
await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
```

to:

```js
await window.loadFile(path.join(__dirname, 'renderer-dist', 'index.html'));
```

- [ ] **Step 4: Replace static renderer tests**

Replace `node-shell/apps/desktop/test/renderer-static.test.js` with:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopDir = path.join(__dirname, '..');

function readDesktopFile(fileName) {
  return fs.readFileSync(path.join(desktopDir, fileName), 'utf8');
}

test('renderer build config points at the React TypeScript entry and dist output', () => {
  const config = readDesktopFile('rsbuild.config.ts');

  assert.match(config, /renderer-src\/src\/main\.tsx/);
  assert.match(config, /renderer-dist/);
  assert.match(config, /pluginReact/);
});

test('React renderer source uses preload API through typed ipc client', () => {
  const client = fs.readFileSync(path.join(desktopDir, 'renderer-src', 'src', 'ipc', 'upiClient.ts'), 'utf8');

  assert.match(client, /window\.upi/);
  assert.match(client, /UPI preload API is unavailable/);
});
```

- [ ] **Step 5: Remove old VM behavior test and old renderer files**

Delete:

```text
node-shell/apps/desktop/test/renderer-behavior.test.js
node-shell/apps/desktop/renderer/index.html
node-shell/apps/desktop/renderer/renderer.js
node-shell/apps/desktop/renderer/styles.css
```

- [ ] **Step 6: Ignore renderer build output**

Add this line to `.gitignore`:

```gitignore
node-shell/apps/desktop/renderer-dist/
```

- [ ] **Step 7: Run node tests and renderer build**

Run:

```bash
npm --prefix node-shell run test:node -- apps/desktop/test/main-ipc.test.js apps/desktop/test/renderer-static.test.js
npm --prefix node-shell run build:renderer
```

Expected: tests PASS and renderer build exits 0.

- [ ] **Step 8: Commit**

```bash
git add .gitignore node-shell/apps/desktop/main.js node-shell/apps/desktop/test/main-ipc.test.js node-shell/apps/desktop/test/renderer-static.test.js node-shell/apps/desktop/test/renderer-behavior.test.js node-shell/apps/desktop/renderer
git commit -m "feat: load built react renderer"
```

---

### Task 9: Full Verification And Manual GUI Check

**Files:**
- No planned source changes.

- [ ] **Step 1: Run the full repository test suite**

Run:

```bash
npm test
```

Expected: all node-shell node tests and renderer Vitest tests PASS.

- [ ] **Step 2: Run renderer build explicitly**

Run:

```bash
npm --prefix node-shell run build:renderer
```

Expected: build exits 0 and `node-shell/apps/desktop/renderer-dist/index.html` exists.

- [ ] **Step 3: Launch the GUI**

Run:

```bash
npm --prefix node-shell run gui
```

Expected: Electron opens the React renderer without a startup error.

- [ ] **Step 4: Manually verify the large directory workflow**

Use the GUI:

```text
1. Click Open.
2. Select a directory with many supported package files.
3. Confirm the left package tree stays within the window height.
4. Confirm the tree shows a draggable vertical scrollbar when content exceeds the sidebar height.
5. Select a supported .pak, .utoc, or .ucas file.
6. Confirm analysis starts and the selected path is visible in the header.
7. Open Packages, Chunks, Blocks, Partitions, or Issues tabs when present.
8. Confirm large result tables scroll vertically without rendering every row at once.
```

- [ ] **Step 5: Commit any verification-only test fixes**

If verification exposes a broken test expectation, fix only that expectation or the narrow behavior under test, then run:

```bash
npm test
git add <changed-files>
git commit -m "test: stabilize react renderer migration"
```

Expected: no commit is created if no verification fix is needed.
