# Packages CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Packages Table `Export CSV...` action that exports the current table rows to a standard CSV file and can later be reused by CLI code.

**Architecture:** Move Packages row, column, sort, and CSV logic into a shared CommonJS module under `node-shell/packages/analysis-domain`. The React renderer imports that shared module for the Table and export action, while Electron main handles Save dialog and file writes through preload IPC.

**Tech Stack:** Node.js CommonJS, Electron IPC/preload, React 19, Ant Design Table/Modal, Zustand vanilla store, Vitest, Node `node:test`.

---

## File Structure

- Create `node-shell/packages/analysis-domain/src/packages-table-export.js`
  Shared pure JavaScript module for package row normalization, table column schema, table sorting, and CSV serialization.

- Create `node-shell/packages/analysis-domain/src/packages-table-export.d.ts`
  Type declarations consumed by renderer TypeScript imports.

- Create `node-shell/packages/analysis-domain/test/packages-table-export.test.js`
  Node tests for the shared module, including CSV escaping and row ordering.

- Modify `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`
  Re-export shared `PackageRow`, `buildPackageRows`, and comparators; keep renderer-only overview, issue, detail, and tree helpers here.

- Modify `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`
  Consume shared table columns and controlled sort state; stop owning hidden default ordering locally.

- Modify `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`
  Verify Table column contract comes from shared schema and sort changes are reported.

- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
  Track current Packages Table sort state, disable export in Tree mode, and pass rows/sort to the store action.

- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
  Verify `Export CSV...` visibility, disabled states, callback arguments, and Tree-mode disablement.

- Modify `node-shell/apps/desktop/main.js`
  Add Save dialog and CSV write IPC handlers.

- Modify `node-shell/apps/desktop/preload.js`
  Expose CSV save/write methods through `window.upi`.

- Modify `node-shell/apps/desktop/test/main-ipc.test.js`
  Cover Save dialog cancel, path extension normalization, and file write behavior.

- Modify `node-shell/apps/desktop/renderer-src/src/types/upi.ts`
  Add preload client types for CSV save/write.

- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`
  Add CSV export lifecycle state, spinner participation, status text, and success/failure dialog state.

- Modify `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`
  Cover cancel, success, failure, stale result, zero rows, and non-mutation of `analysisResult`.

- Modify `node-shell/apps/desktop/renderer-src/src/App.tsx`
  Include `isExportingPackagesCsv` in the shell busy spinner and render CSV result modals.

- Modify `node-shell/apps/desktop/renderer-src/src/App.test.tsx`
  Verify App passes export state/actions into `AnalysisTabs` and renders CSV result modal.

- Modify `node-shell/apps/desktop/test/electron-gui-smoke.test.js`
  Add `Export CSV...` to the expected visible UI text.

---

### Task 1: Shared Packages Table And CSV Module

**Files:**
- Create: `node-shell/packages/analysis-domain/src/packages-table-export.js`
- Create: `node-shell/packages/analysis-domain/src/packages-table-export.d.ts`
- Create: `node-shell/packages/analysis-domain/test/packages-table-export.test.js`

- [ ] **Step 1: Write the failing shared-module tests**

Create `node-shell/packages/analysis-domain/test/packages-table-export.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PACKAGE_TABLE_COLUMNS,
  PACKAGE_TABLE_DEFAULT_SORT,
  buildPackageRows,
  comparePackageFileName,
  comparePackageOrder,
  serializePackagesCsv,
  sortPackageRows,
} = require('../src/packages-table-export.js');

test('buildPackageRows normalizes package entries and duplicate ids', () => {
  const rows = buildPackageRows({
    packages: [
      { packagePath: '../../../Game/Beta.uasset', size: '20', compressedSize: '10', order: '2' },
      { packagePath: '../../../Game/Alpha.uasset', diskSize: 30n, compressed_size: 12n, physical_order: 1 },
      { relativePath: '../../../Game/Alpha.uasset', size: 40, order: 3 },
      { packagePath: '   ', path: '../../../Game/Fallback.uasset', size: 5 },
      { size: 99 },
    ],
  });

  assert.deepEqual(rows.map((row) => ({
    id: row.id,
    fullPath: row.fullPath,
    fileName: row.fileName,
    size: row.size,
    compressedSize: row.compressedSize,
    physicalOrder: row.physicalOrder,
  })), [
    {
      id: '../../../Game/Alpha.uasset',
      fullPath: '../../../Game/Alpha.uasset',
      fileName: 'Alpha.uasset',
      size: 30,
      compressedSize: 12,
      physicalOrder: 1,
    },
    {
      id: '../../../Game/Alpha.uasset#2',
      fullPath: '../../../Game/Alpha.uasset',
      fileName: 'Alpha.uasset',
      size: 40,
      compressedSize: undefined,
      physicalOrder: 3,
    },
    {
      id: '../../../Game/Beta.uasset',
      fullPath: '../../../Game/Beta.uasset',
      fileName: 'Beta.uasset',
      size: 20,
      compressedSize: 10,
      physicalOrder: 2,
    },
    {
      id: '../../../Game/Fallback.uasset',
      fullPath: '../../../Game/Fallback.uasset',
      fileName: 'Fallback.uasset',
      size: 5,
      compressedSize: undefined,
      physicalOrder: undefined,
    },
  ]);
});

test('PACKAGE_TABLE_COLUMNS defines the Packages table and raw CSV values', () => {
  assert.deepEqual(PACKAGE_TABLE_COLUMNS.map(({ key, dataIndex, title, width }) => ({
    key,
    dataIndex,
    title,
    width,
  })), [
    { key: 'fullPath', dataIndex: 'fullPath', title: 'Full Path', width: 520 },
    { key: 'size', dataIndex: 'size', title: 'Size', width: 120 },
    { key: 'compressedSize', dataIndex: 'compressedSize', title: 'Compressed', width: 140 },
    { key: 'physicalOrder', dataIndex: 'physicalOrder', title: 'Order', width: 100 },
  ]);

  const row = {
    id: 'row',
    fullPath: '../../../Game/Foo.uasset',
    fileName: 'Foo.uasset',
    size: 2048,
    compressedSize: 1024,
    physicalOrder: 7,
    source: {},
  };
  assert.deepEqual(PACKAGE_TABLE_COLUMNS.map((column) => column.exportValue(row)), [
    '../../../Game/Foo.uasset',
    2048,
    1024,
    7,
  ]);
});

test('sortPackageRows uses physical order by default and user sort when provided', () => {
  const rows = [
    { id: 'b', fullPath: '/Game/Beta.uasset', fileName: 'Beta.uasset', size: 10, physicalOrder: 8, source: {} },
    { id: 'a', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', size: 20, physicalOrder: 1, source: {} },
    { id: 'c', fullPath: '/Game/Gamma.uasset', fileName: 'Gamma.uasset', size: 5, physicalOrder: 3, source: {} },
  ];

  assert.equal(PACKAGE_TABLE_DEFAULT_SORT.columnKey, 'physicalOrder');
  assert.equal(PACKAGE_TABLE_DEFAULT_SORT.order, 'ascend');
  assert.deepEqual(sortPackageRows(rows).map((row) => row.id), ['a', 'c', 'b']);
  assert.deepEqual(
    sortPackageRows(rows, { columnKey: 'size', order: 'descend' }).map((row) => row.id),
    ['a', 'b', 'c'],
  );
});

test('comparators remain available for renderer detail and tree code', () => {
  const rows = [
    { id: 'b', fullPath: '/Game/Beta.uasset', fileName: 'Beta.uasset', physicalOrder: 8, source: {} },
    { id: 'a', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOrder: 1, source: {} },
  ];

  assert.deepEqual([...rows].sort(comparePackageFileName).map((row) => row.id), ['a', 'b']);
  assert.deepEqual([...rows].sort(comparePackageOrder).map((row) => row.id), ['a', 'b']);
});

test('serializePackagesCsv emits UTF-8 BOM, headers, CRLF, blanks, and standard CSV escaping', () => {
  const rows = [
    {
      id: 'quoted',
      fullPath: '../../../Game/Foo, \"Bar\".uasset',
      fileName: 'Foo, \"Bar\".uasset',
      size: 2048,
      compressedSize: undefined,
      physicalOrder: 2,
      source: {},
    },
    {
      id: 'newline',
      fullPath: '../../../Game/Line\r\nBreak.uasset',
      fileName: 'LineBreak.uasset',
      size: 10,
      compressedSize: 5,
      physicalOrder: 1,
      source: {},
    },
  ];

  assert.equal(
    serializePackagesCsv(rows),
    '\ufeffFull Path,Size,Compressed,Order\r\n'
      + '\"../../../Game/Foo, \"\"Bar\"\".uasset\",2048,,2\r\n'
      + '\"../../../Game/Line\r\nBreak.uasset\",10,5,1\r\n',
  );
});
```

- [ ] **Step 2: Run the shared-module tests and verify they fail**

Run:

```powershell
node --test node-shell/packages/analysis-domain/test/packages-table-export.test.js
```

Expected: FAIL with `Cannot find module '../src/packages-table-export.js'`.

- [ ] **Step 3: Implement the shared module**

Create `node-shell/packages/analysis-domain/src/packages-table-export.js`:

```js
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  return undefined;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const numberValue = toFiniteNumber(value);
    if (numberValue !== undefined) {
      return numberValue;
    }
  }
  return undefined;
}

function firstPathValue(record) {
  const values = [
    record.packagePath,
    record.package_path,
    record.path,
    record.fullPath,
    record.full_path,
    record.relativePath,
    record.relative_path,
    record.name,
  ];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmedValue = value.trim();
    if (trimmedValue !== '') {
      return trimmedValue;
    }
  }
  return undefined;
}

function pathSegments(filePath) {
  return filePath.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}

function fileNameFromPath(filePath) {
  const segments = pathSegments(filePath);
  return segments[segments.length - 1] || filePath;
}

function typeFromFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function comparePackagePath(left, right) {
  return (
    compareText(left.fileName, right.fileName)
    || compareText(left.fullPath, right.fullPath)
    || compareText(left.id || '', right.id || '')
  );
}

function comparePackageFileName(left, right) {
  return comparePackagePath(left, right);
}

function compareNumericField(field) {
  return (left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];
    const leftHasValue = leftValue !== undefined && Number.isFinite(leftValue);
    const rightHasValue = rightValue !== undefined && Number.isFinite(rightValue);

    if (leftHasValue && rightHasValue && leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    if (leftHasValue !== rightHasValue) {
      return leftHasValue ? -1 : 1;
    }
    return comparePackageFileName(left, right);
  };
}

function comparePackageOrder(left, right) {
  return compareNumericField('physicalOrder')(left, right);
}

const PACKAGE_TABLE_COLUMNS = Object.freeze([
  Object.freeze({
    key: 'fullPath',
    dataIndex: 'fullPath',
    title: 'Full Path',
    width: 520,
    fixed: 'left',
    className: 'package-path-column',
    exportValue: (row) => row.fullPath,
  }),
  Object.freeze({
    key: 'size',
    dataIndex: 'size',
    title: 'Size',
    width: 120,
    compare: compareNumericField('size'),
    exportValue: (row) => row.size,
  }),
  Object.freeze({
    key: 'compressedSize',
    dataIndex: 'compressedSize',
    title: 'Compressed',
    width: 140,
    compare: compareNumericField('compressedSize'),
    exportValue: (row) => row.compressedSize,
  }),
  Object.freeze({
    key: 'physicalOrder',
    dataIndex: 'physicalOrder',
    title: 'Order',
    width: 100,
    compare: compareNumericField('physicalOrder'),
    exportValue: (row) => row.physicalOrder,
  }),
]);

const PACKAGE_TABLE_DEFAULT_SORT = Object.freeze({
  columnKey: 'physicalOrder',
  order: 'ascend',
});

function buildPackageRows(result) {
  const packages = Array.isArray(result?.packages) ? result.packages : [];
  const duplicateCounts = new Map();
  const rows = packages.reduce((draftRows, packageEntry) => {
    if (!isRecord(packageEntry)) {
      return draftRows;
    }

    const fullPath = firstPathValue(packageEntry);
    if (!fullPath) {
      return draftRows;
    }

    const fileName = fileNameFromPath(fullPath);
    const type = typeFromFileName(fileName);
    const size = firstFiniteNumber([
      packageEntry.size,
      packageEntry.diskSize,
      packageEntry.disk_size,
      packageEntry.uncompressedSize,
      packageEntry.uncompressed_size,
    ]);
    const compressedSize = firstFiniteNumber([
      packageEntry.compressedSize,
      packageEntry.compressed_size,
    ]);
    const physicalOrder = firstFiniteNumber([
      packageEntry.order,
      packageEntry.physicalOrder,
      packageEntry.physical_order,
    ]);
    const row = { fullPath, fileName, source: packageEntry };

    if (type !== undefined) row.type = type;
    if (size !== undefined) row.size = size;
    if (compressedSize !== undefined) row.compressedSize = compressedSize;
    if (physicalOrder !== undefined) row.physicalOrder = physicalOrder;

    draftRows.push(row);
    return draftRows;
  }, []);

  return rows
    .sort(comparePackagePath)
    .map((row) => {
      const duplicateCount = (duplicateCounts.get(row.fullPath) || 0) + 1;
      duplicateCounts.set(row.fullPath, duplicateCount);
      return {
        id: duplicateCount === 1 ? row.fullPath : `${row.fullPath}#${duplicateCount}`,
        ...row,
      };
    });
}

function sortPackageRows(rows, sortState = PACKAGE_TABLE_DEFAULT_SORT) {
  const effectiveSort = sortState || PACKAGE_TABLE_DEFAULT_SORT;
  const column = PACKAGE_TABLE_COLUMNS.find((candidate) => candidate.key === effectiveSort.columnKey);
  const compare = column?.compare || comparePackageFileName;
  const direction = effectiveSort.order === 'descend' ? -1 : 1;
  return [...rows].sort((left, right) => compare(left, right) * direction);
}

function csvCell(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `\"${text.replace(/"/g, '""')}\"`;
}

function serializePackagesCsv(rows, columns = PACKAGE_TABLE_COLUMNS) {
  const lines = [
    columns.map((column) => csvCell(column.title)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column.exportValue(row))).join(',')),
  ];
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

module.exports = {
  PACKAGE_TABLE_COLUMNS,
  PACKAGE_TABLE_DEFAULT_SORT,
  buildPackageRows,
  comparePackageFileName,
  comparePackageOrder,
  serializePackagesCsv,
  sortPackageRows,
};
```

- [ ] **Step 4: Add TypeScript declarations for renderer imports**

Create `node-shell/packages/analysis-domain/src/packages-table-export.d.ts`:

```ts
export type PackageRow = {
  id: string;
  fullPath: string;
  fileName: string;
  type?: string;
  size?: number;
  compressedSize?: number;
  physicalOrder?: number;
  source: Record<string, unknown>;
};

export type PackageTableColumnKey = 'fullPath' | 'size' | 'compressedSize' | 'physicalOrder';
export type PackageTableSortOrder = 'ascend' | 'descend';
export type PackageTableSortState = {
  columnKey: PackageTableColumnKey;
  order: PackageTableSortOrder;
} | null;

export type PackageTableColumn = {
  key: PackageTableColumnKey;
  dataIndex: keyof PackageRow;
  title: string;
  width: number;
  fixed?: 'left';
  className?: string;
  compare?: (left: PackageRow, right: PackageRow) => number;
  exportValue(row: PackageRow): string | number | undefined;
};

export const PACKAGE_TABLE_COLUMNS: readonly PackageTableColumn[];
export const PACKAGE_TABLE_DEFAULT_SORT: Exclude<PackageTableSortState, null>;
export function buildPackageRows(result: { packages?: unknown[] } | null | undefined): PackageRow[];
export function comparePackageFileName(left: PackageRow, right: PackageRow): number;
export function comparePackageOrder(left: PackageRow, right: PackageRow): number;
export function serializePackagesCsv(
  rows: PackageRow[],
  columns?: readonly PackageTableColumn[],
): string;
export function sortPackageRows(
  rows: PackageRow[],
  sortState?: PackageTableSortState,
): PackageRow[];
```

- [ ] **Step 5: Run shared-module tests and verify they pass**

Run:

```powershell
node --test node-shell/packages/analysis-domain/test/packages-table-export.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the shared module**

Run:

```powershell
git add node-shell/packages/analysis-domain/src/packages-table-export.js node-shell/packages/analysis-domain/src/packages-table-export.d.ts node-shell/packages/analysis-domain/test/packages-table-export.test.js
git commit -m "Add shared packages CSV export model"
```

---

### Task 2: Move Renderer View Model To Shared Package Rows

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`

- [ ] **Step 1: Update renderer view-model tests for shared default ordering**

In `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`, update the import and expectations so they continue to assert row normalization through the renderer public view model:

```ts
import {
  ANALYSIS_TABS,
  buildAnalysisViewModel,
  buildIssueRows,
  buildOverviewCards,
  buildPackageRows,
  buildPackageTree,
  comparePackageFileName,
  comparePackageOrder,
  type AnalysisTabModel,
  type PackageRow,
} from './analysisViewModel';
```

Keep the existing `buildPackageRows` tests. Add this test to prove the renderer uses the shared module:

```ts
test('buildAnalysisViewModel exposes package rows from the shared packages model', () => {
  const viewModel = buildAnalysisViewModel({
    packages: [
      { packagePath: '../../../Game/B.uasset', order: 2 },
      { packagePath: '../../../Game/A.uasset', order: 1 },
    ],
  });

  expect(viewModel.packageRows.map((row) => row.id)).toEqual([
    '../../../Game/A.uasset',
    '../../../Game/B.uasset',
  ]);
});
```

- [ ] **Step 2: Run renderer view-model tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

Expected: FAIL until `analysisViewModel.ts` imports from the shared module.

- [ ] **Step 3: Replace local row normalization with shared imports**

In `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`, remove local definitions that duplicate `PackageRow`, `buildPackageRows`, `comparePackageFileName`, and `comparePackageOrder`. Add these imports near the top:

```ts
import {
  buildPackageRows as buildSharedPackageRows,
  comparePackageFileName,
  comparePackageOrder,
  type PackageRow,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Then export the shared type and functions:

```ts
export type { PackageRow };
export { comparePackageFileName, comparePackageOrder };

export function buildPackageRows(result: AnalysisResult | null): PackageRow[] {
  return buildSharedPackageRows(result);
}
```

Keep these renderer-only helpers in `analysisViewModel.ts`:

```ts
export type AnalysisTabId = 'overview' | 'packages' | 'issues';
export type PackageMode = 'table' | 'tree';
export type PackageTreeItem = {
  key: string;
  title: string;
  children?: PackageTreeItem[];
  packageRowId?: string;
  selectable?: boolean;
};
export type DetailSelection =
  | { kind: 'package'; row: PackageRow }
  | { kind: 'issue'; row: IssueRow };
```

- [ ] **Step 4: Run renderer view-model tests and typecheck**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
npm.cmd --prefix node-shell run typecheck:renderer
```

Expected: PASS.

- [ ] **Step 5: Commit the renderer view-model move**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
git commit -m "Share packages table row model with renderer"
```

---

### Task 3: Controlled Packages Table Sorting And Export Schema

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`

- [ ] **Step 1: Update PackageTable tests for controlled sort state**

In `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`, extend `MockTableProps`:

```ts
type MockTableProps = {
  bordered?: boolean;
  columns?: MockColumn[];
  dataSource?: PackageRow[];
  onChange?: (_pagination: unknown, _filters: unknown, sorter: unknown) => void;
  pagination?: false;
  rowKey?: string;
  scroll?: { x?: number; y?: number };
  size?: string;
  tableLayout?: string;
  virtual?: boolean;
  onRow?: (row: PackageRow) => { onClick?: () => void };
};
```

Extend `MockColumn`:

```ts
type MockColumn = {
  title?: React.ReactNode;
  dataIndex?: string;
  key?: string;
  fixed?: string;
  ellipsis?: boolean;
  width?: number;
  className?: string;
  sortOrder?: 'ascend' | 'descend' | null;
  sorter?: (left: PackageRow, right: PackageRow) => number;
  render?: (value: unknown, row: PackageRow) => React.ReactNode;
};
```

Change the default data source test to expect physical order:

```ts
test('sorts the data source by package physical order before rendering', () => {
  render(<PackageTable rows={rows} height={320} sortState={null} onSortChange={() => {}} onSelectPackage={() => {}} />);

  expect(latestTableProps().dataSource?.map((row) => row.id)).toEqual(['base', 'beta']);
});
```

Add a sort callback test:

```ts
test('reports supported table sort changes', () => {
  const onSortChange = vi.fn();
  render(<PackageTable rows={rows} height={320} sortState={null} onSortChange={onSortChange} onSelectPackage={() => {}} />);

  latestTableProps().onChange?.({}, {}, { columnKey: 'size', order: 'descend' });

  expect(onSortChange).toHaveBeenCalledWith({ columnKey: 'size', order: 'descend' });
});
```

- [ ] **Step 2: Run PackageTable tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx
```

Expected: FAIL because `PackageTable` does not accept `sortState` or `onSortChange`.

- [ ] **Step 3: Implement controlled sorting in PackageTable**

In `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`, import the shared schema:

```ts
import {
  PACKAGE_TABLE_COLUMNS,
  sortPackageRows,
  type PackageTableColumnKey,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Update props:

```ts
type PackageTableProps = {
  rows: PackageRow[];
  height: number;
  sortState: PackageTableSortState;
  onSortChange(sortState: PackageTableSortState): void;
  onSelectPackage(row: PackageRow): void;
};
```

Create table columns from the shared schema:

```ts
function normalizeSorter(sorter: unknown): PackageTableSortState {
  if (!sorter || typeof sorter !== 'object' || Array.isArray(sorter)) {
    return null;
  }
  const candidate = sorter as { columnKey?: unknown; order?: unknown };
  const columnKey = typeof candidate.columnKey === 'string' ? candidate.columnKey : '';
  const order = candidate.order === 'ascend' || candidate.order === 'descend' ? candidate.order : null;

  if (!order || !PACKAGE_TABLE_COLUMNS.some((column) => column.key === columnKey)) {
    return null;
  }

  return { columnKey: columnKey as PackageTableColumnKey, order };
}

function buildColumns(sortState: PackageTableSortState): ColumnsType<PackageRow> {
  return PACKAGE_TABLE_COLUMNS.map((column) => ({
    dataIndex: column.dataIndex,
    key: column.key,
    title: column.title,
    fixed: column.fixed,
    ellipsis: column.key === 'fullPath' ? false : undefined,
    width: column.width,
    className: column.className,
    sorter: column.compare,
    sortOrder: sortState?.columnKey === column.key ? sortState.order : null,
    render: (value: PackageRow[typeof column.dataIndex], row: PackageRow) => {
      if (column.key === 'fullPath') {
        return (
          <span className="package-path-cell" title={row.fullPath}>
            {row.fullPath}
          </span>
        );
      }
      if (column.key === 'size' || column.key === 'compressedSize') {
        return formatBytes(value as number | undefined);
      }
      return value ?? '';
    },
  }));
}
```

Update component body:

```tsx
export function PackageTable({ rows, height, sortState, onSortChange, onSelectPackage }: PackageTableProps) {
  const columns = useMemo(() => buildColumns(sortState), [sortState]);
  const dataSource = useMemo(() => sortPackageRows(rows, sortState), [rows, sortState]);
  const handleChange = useCallback((_pagination: unknown, _filters: unknown, sorter: unknown) => {
    onSortChange(normalizeSorter(sorter));
  }, [onSortChange]);
  const handleRow = useCallback((row: PackageRow) => ({
    onClick: () => {
      onSelectPackage(row);
    },
  }), [onSelectPackage]);

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No packages to show." />;
  }

  return (
    <Table<PackageRow>
      bordered
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      rowKey="id"
      scroll={{ x: 880, y: height }}
      size="small"
      tableLayout="auto"
      virtual
      onChange={handleChange}
      onRow={handleRow}
    />
  );
}
```

- [ ] **Step 4: Update AnalysisTabs tests for Export CSV**

In `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`, extend props:

```ts
type PackageTableProbeProps = {
  rows: PackageRow[];
  height: number;
  sortState: PackageTableSortState;
  onSortChange(sortState: PackageTableSortState): void;
  onSelectPackage(row: PackageRow): void;
};
```

Add the shared type import:

```ts
import type { PackageTableSortState } from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Extend `renderTabs` options with `isExportingPackagesCsv` and `onExportPackagesCsv`. Add tests:

```ts
test('Packages tab renders Export CSV button and invokes the export callback with rows and sort state', () => {
  const onExportPackagesCsv = vi.fn();
  renderTabs(analysisResult(), { onExportPackagesCsv });

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV...' }));

  expect(onExportPackagesCsv).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ fullPath: fooPath })]),
    null,
  );
});

test('Export CSV button is disabled in Tree mode', () => {
  renderTabs(analysisResult());

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));

  expect(screen.getByRole('button', { name: 'Export CSV...' })).toBeDisabled();
});

test('Export CSV button shows loading state while export is in progress', () => {
  renderTabs(analysisResult(), { isExportingPackagesCsv: true });

  fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));

  const button = screen.getByRole('button', { name: 'Export CSV...' });
  expect(button).toHaveAttribute('data-loading', 'true');
  expect(button).toBeDisabled();
});
```

- [ ] **Step 5: Run AnalysisTabs tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

Expected: FAIL because `AnalysisTabs` has no export props.

- [ ] **Step 6: Implement AnalysisTabs export wiring**

In `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`, import sort types:

```ts
import type { PackageTableSortState } from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Extend props:

```ts
type AnalysisTabsProps = {
  result: AnalysisResult | null;
  selectedFilePath: string;
  isExtracting: boolean;
  isExportingPackagesCsv: boolean;
  selectedPackageId: string;
  tableHeight: number;
  onDetailsSelectionChange(selection: DetailSelection | null): void;
  onExtractSelectedContainer(): void;
  onExportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): void;
};
```

Update `PackagePaneProps`:

```ts
type PackagePaneProps = {
  canExportCsv: boolean;
  canExtract: boolean;
  fallbackHeight: number;
  isExportingPackagesCsv: boolean;
  isExtracting: boolean;
  mode: PackageMode;
  rows: PackageRow[];
  selectedPackageId: string;
  sortState: PackageTableSortState;
  onModeChange(mode: PackageMode): void;
  onExtractSelectedContainer(): void;
  onExportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): void;
  onSelectPackage(row: PackageRow): void;
  onSortChange(sortState: PackageTableSortState): void;
};
```

Render the export button beside extract:

```tsx
<Button
  disabled={!canExportCsv || isExportingPackagesCsv}
  loading={isExportingPackagesCsv}
  onClick={() => onExportPackagesCsv(rows, sortState)}
>
  Export CSV...
</Button>
<Button
  disabled={!canExtract || isExtracting}
  loading={isExtracting}
  onClick={onExtractSelectedContainer}
>
  Extract to...
</Button>
```

Track sort state in `AnalysisTabs`:

```ts
const [packageSortState, setPackageSortState] = useState<PackageTableSortState>(null);

useEffect(() => {
  setActiveTab('overview');
  setPackageMode('table');
  setPackageSortState(null);
  onDetailsSelectionChange(null);
}, [result, onDetailsSelectionChange]);
```

Pass props into `PackageTable`:

```tsx
<PackageTable
  height={packageHeight}
  rows={rows}
  sortState={sortState}
  onSortChange={onSortChange}
  onSelectPackage={onSelectPackage}
/>
```

Compute export availability:

```tsx
canExportCsv={Boolean(
  mode === 'table'
  && selectedFilePath
  && result
  && viewModel.packageRows.length > 0
)}
```

- [ ] **Step 7: Run PackageTable and AnalysisTabs tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit controlled table/export UI wiring**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
git commit -m "Wire packages table sorting for CSV export"
```

---

### Task 4: Electron Main And Preload CSV File IPC

**Files:**
- Modify: `node-shell/apps/desktop/main.js`
- Modify: `node-shell/apps/desktop/preload.js`
- Modify: `node-shell/apps/desktop/test/main-ipc.test.js`
- Modify: `node-shell/apps/desktop/renderer-src/src/types/upi.ts`

- [ ] **Step 1: Write failing Electron main IPC tests**

Add to `node-shell/apps/desktop/test/main-ipc.test.js`:

```js
test('packagesCsv:chooseSavePath returns null when save dialog is canceled', async () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showSaveDialog(options) {
        assert.equal(options.title, 'Export CSV...');
        assert.deepEqual(options.filters, [{ name: 'CSV Files', extensions: ['csv'] }]);
        assert.equal(options.defaultPath, 'A.pak.packages.csv');
        return { canceled: true };
      },
    },
  });

  const result = await handlers.choosePackagesCsvSavePath('C:\\Paks\\A.pak');

  assert.equal(result, null);
});

test('packagesCsv:chooseSavePath normalizes missing csv extension', async () => {
  const state = createDesktopState();
  const handlers = createIpcHandlers({
    state,
    dialog: {
      async showSaveDialog() {
        return { canceled: false, filePath: 'D:\\Exports\\A.pak.packages' };
      },
    },
  });

  const result = await handlers.choosePackagesCsvSavePath('C:\\Paks\\A.pak');

  assert.deepEqual(result, { filePath: 'D:\\Exports\\A.pak.packages.csv' });
});

test('packagesCsv:write writes csv text and reports byte count', async () => {
  const writes = [];
  const state = createDesktopState();
  const handlers = createIpcHandlers({
    state,
    fs: {
      promises: {
        async writeFile(filePath, content, encoding) {
          writes.push({ filePath, content, encoding });
        },
      },
    },
  });

  const result = await handlers.writePackagesCsv('D:\\Exports\\A.csv', '\ufeffFull Path\r\n');

  assert.deepEqual(writes, [{
    filePath: 'D:\\Exports\\A.csv',
    content: '\ufeffFull Path\r\n',
    encoding: 'utf8',
  }]);
  assert.deepEqual(result, {
    filePath: 'D:\\Exports\\A.csv',
    byteCount: Buffer.byteLength('\ufeffFull Path\r\n', 'utf8'),
  });
});
```

- [ ] **Step 2: Run Electron main IPC tests and verify they fail**

Run:

```powershell
node --test node-shell/apps/desktop/test/main-ipc.test.js
```

Expected: FAIL because the handlers are missing.

- [ ] **Step 3: Implement main process handlers**

In `node-shell/apps/desktop/main.js`, add:

```js
const fs = require('node:fs');
```

Add helper functions:

```js
function ensureCsvExtension(filePath) {
  return /\.csv$/i.test(filePath) ? filePath : `${filePath}.csv`;
}

function packagesCsvDefaultPath(filePath) {
  const baseName = path.win32.basename(filePath || 'packages');
  return `${baseName}.packages.csv`;
}
```

Update `createIpcHandlers` parameters:

```js
function createIpcHandlers({
  state,
  dialog: dialogModule = dialog,
  fs: fsModule = fs,
  scanPackageDirectory: scanPackageDirectoryFn = scanPackageDirectory,
  AnalysisService: AnalysisServiceClass = AnalysisService,
} = {}) {
```

Add handler methods:

```js
async choosePackagesCsvSavePath(filePath) {
  const selection = await dialogModule.showSaveDialog({
    title: 'Export CSV...',
    defaultPath: packagesCsvDefaultPath(filePath),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });

  if (selection.canceled || !selection.filePath) {
    return null;
  }

  return { filePath: ensureCsvExtension(selection.filePath) };
},

async writePackagesCsv(filePath, csvText) {
  const normalizedPath = ensureCsvExtension(String(filePath || ''));
  if (!normalizedPath || normalizedPath === '.csv') {
    throw new Error('Select a CSV output file before exporting.');
  }

  const content = String(csvText || '');
  await fsModule.promises.writeFile(normalizedPath, content, 'utf8');
  return {
    filePath: normalizedPath,
    byteCount: Buffer.byteLength(content, 'utf8'),
  };
},
```

Register IPC:

```js
ipcMainModule.handle('packagesCsv:chooseSavePath', (_event, filePath) => (
  handlers.choosePackagesCsvSavePath(filePath)
));
ipcMainModule.handle('packagesCsv:write', (_event, filePath, csvText) => (
  handlers.writePackagesCsv(filePath, csvText)
));
```

Export helpers for tests if useful:

```js
ensureCsvExtension,
packagesCsvDefaultPath,
```

- [ ] **Step 4: Update preload API**

In `node-shell/apps/desktop/preload.js`, add:

```js
choosePackagesCsvSavePath(filePath) {
  return ipcRenderer.invoke('packagesCsv:chooseSavePath', filePath);
},

writePackagesCsv(filePath, csvText) {
  return ipcRenderer.invoke('packagesCsv:write', filePath, csvText);
},
```

- [ ] **Step 5: Update renderer preload types**

In `node-shell/apps/desktop/renderer-src/src/types/upi.ts`, add:

```ts
export type PackagesCsvSavePathResult = {
  filePath: string;
};

export type PackagesCsvWriteResult = {
  filePath: string;
  byteCount: number;
};
```

Extend `UpiClient`:

```ts
choosePackagesCsvSavePath(filePath: string): Promise<PackagesCsvSavePathResult | null>;
writePackagesCsv(filePath: string, csvText: string): Promise<PackagesCsvWriteResult>;
```

- [ ] **Step 6: Run IPC tests and renderer typecheck**

Run:

```powershell
node --test node-shell/apps/desktop/test/main-ipc.test.js
npm.cmd --prefix node-shell run typecheck:renderer
```

Expected: PASS.

- [ ] **Step 7: Commit Electron CSV IPC**

Run:

```powershell
git add node-shell/apps/desktop/main.js node-shell/apps/desktop/preload.js node-shell/apps/desktop/test/main-ipc.test.js node-shell/apps/desktop/renderer-src/src/types/upi.ts
git commit -m "Add packages CSV file IPC"
```

---

### Task 5: Zustand CSV Export Lifecycle

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`

- [ ] **Step 1: Write failing app store tests**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts`, import shared types:

```ts
import type { PackageRow } from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Extend `createClient` defaults:

```ts
choosePackagesCsvSavePath: async () => ({ filePath: 'D:\\Exports\\A.pak.packages.csv' }),
writePackagesCsv: async (filePath, csvText) => ({
  filePath,
  byteCount: new TextEncoder().encode(csvText).byteLength,
}),
```

Add helper rows:

```ts
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
```

Add tests:

```ts
test('exportPackagesCsv reports cancel without changing analysis result', async () => {
  const store = createAppStore(createClient({
    choosePackagesCsvSavePath: async () => null,
  }));
  await store.getState().analyzeFile('C:\\Paks\\A.pak');
  const before = store.getState().analysisResult;

  await store.getState().exportPackagesCsv(exportRows, null);

  expect(store.getState().analysisResult).toBe(before);
  expect(store.getState().statusText).toBe('CSV export canceled');
  expect(store.getState().dialog.packagesCsvExport).toBeNull();
  expect(store.getState().isExportingPackagesCsv).toBe(false);
});

test('exportPackagesCsv writes csv and opens success dialog', async () => {
  const writes: Array<{ filePath: string; csvText: string }> = [];
  const store = createAppStore(createClient({
    writePackagesCsv: async (filePath, csvText) => {
      writes.push({ filePath, csvText });
      return { filePath, byteCount: new TextEncoder().encode(csvText).byteLength };
    },
  }));
  await store.getState().analyzeFile('C:\\Paks\\A.pak');
  const before = store.getState().analysisResult;

  await store.getState().exportPackagesCsv(exportRows, null);

  expect(writes[0]).toEqual({
    filePath: 'D:\\Exports\\A.pak.packages.csv',
    csvText: '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/A.uasset,20,10,1\r\n',
  });
  expect(store.getState().analysisResult).toBe(before);
  expect(store.getState().statusText).toBe('CSV exported');
  expect(store.getState().dialog.packagesCsvExport).toEqual({
    kind: 'success',
    title: 'CSV exported',
    message: 'D:\\Exports\\A.pak.packages.csv\n1 package exported.',
  });
});

test('exportPackagesCsv shows failure dialog without mutating analysis issues', async () => {
  const store = createAppStore(createClient({
    writePackagesCsv: async () => {
      throw new Error('Disk is full');
    },
  }));
  await store.getState().analyzeFile('C:\\Paks\\A.pak');
  const before = store.getState().analysisResult;

  await store.getState().exportPackagesCsv(exportRows, null);

  expect(store.getState().analysisResult).toBe(before);
  expect(store.getState().statusText).toBe('CSV export failed');
  expect(store.getState().dialog.packagesCsvExport).toEqual({
    kind: 'error',
    title: 'CSV export failed',
    message: 'Disk is full',
  });
});

test('exportPackagesCsv refuses empty row exports', async () => {
  const store = createAppStore(createClient());
  await store.getState().analyzeFile('C:\\Paks\\A.pak');

  await store.getState().exportPackagesCsv([], null);

  expect(store.getState().statusText).toBe('CSV export failed');
  expect(store.getState().dialog.packagesCsvExport).toEqual({
    kind: 'error',
    title: 'CSV export failed',
    message: 'No packages to export.',
  });
});
```

- [ ] **Step 2: Run app store tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: FAIL because the store has no CSV export lifecycle.

- [ ] **Step 3: Implement CSV export state and action**

In `node-shell/apps/desktop/renderer-src/src/stores/appStore.ts`, import shared module:

```ts
import {
  serializePackagesCsv,
  sortPackageRows,
  type PackageRow,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
```

Add types:

```ts
export type PackagesCsvExportDialog = {
  kind: 'success' | 'error';
  title: string;
  message: string;
};
```

Extend `DialogState`:

```ts
packagesCsvExport: PackagesCsvExportDialog | null;
```

Update `createDialogState` default:

```ts
packagesCsvExport: null,
```

Extend `AppState`:

```ts
isExportingPackagesCsv: boolean;
packagesCsvExportRequestId: number;
exportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): Promise<void>;
dismissPackagesCsvExportDialog(): void;
```

Add stale guard:

```ts
function isCurrentPackagesCsvExport(
  state: AppState,
  filePath: string,
  requestId: number,
  analysisRequestId: number,
): boolean {
  return state.selectedFilePath === filePath
    && state.packagesCsvExportRequestId === requestId
    && state.analysisRequestId === analysisRequestId;
}
```

Initialize state:

```ts
isExportingPackagesCsv: false,
packagesCsvExportRequestId: 0,
```

Increment and clear CSV state in `openDirectory()` and `analyzeFile()` alongside extraction state:

```ts
packagesCsvExportRequestId: state.packagesCsvExportRequestId + 1,
isExportingPackagesCsv: false,
```

Add action:

```ts
async exportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState) {
  const filePath = get().selectedFilePath;
  if (!filePath) {
    set((state) => ({
      statusText: 'CSV export failed',
      dialog: {
        ...state.dialog,
        packagesCsvExport: {
          kind: 'error',
          title: 'CSV export failed',
          message: 'Select a container first.',
        },
      },
    }));
    return;
  }

  if (rows.length === 0) {
    set((state) => ({
      statusText: 'CSV export failed',
      dialog: {
        ...state.dialog,
        packagesCsvExport: {
          kind: 'error',
          title: 'CSV export failed',
          message: 'No packages to export.',
        },
      },
    }));
    return;
  }

  const requestId = get().packagesCsvExportRequestId + 1;
  const analysisRequestId = get().analysisRequestId;
  set((state) => ({
    packagesCsvExportRequestId: requestId,
    isExportingPackagesCsv: true,
    statusText: 'Exporting CSV...',
    dialog: {
      ...state.dialog,
      packagesCsvExport: null,
    },
  }));

  try {
    const savePath = await client.choosePackagesCsvSavePath(filePath);
    if (!isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
      return;
    }
    if (!savePath) {
      set({ statusText: 'CSV export canceled' });
      return;
    }

    const sortedRows = sortPackageRows(rows, sortState);
    const csvText = serializePackagesCsv(sortedRows);
    const result = await client.writePackagesCsv(savePath.filePath, csvText);
    if (!isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
      return;
    }

    const countLabel = sortedRows.length === 1 ? '1 package exported.' : `${sortedRows.length} packages exported.`;
    set((state) => ({
      statusText: 'CSV exported',
      dialog: {
        ...state.dialog,
        packagesCsvExport: {
          kind: 'success',
          title: 'CSV exported',
          message: `${result.filePath}\n${countLabel}`,
        },
      },
    }));
  } catch (error) {
    if (!isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
      return;
    }

    set((state) => ({
      statusText: 'CSV export failed',
      dialog: {
        ...state.dialog,
        packagesCsvExport: {
          kind: 'error',
          title: 'CSV export failed',
          message: getErrorMessage(error),
        },
      },
    }));
  } finally {
    if (isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
      set({ isExportingPackagesCsv: false });
    }
  }
},

dismissPackagesCsvExportDialog() {
  set((state) => ({
    dialog: {
      ...state.dialog,
      packagesCsvExport: null,
    },
  }));
},
```

- [ ] **Step 4: Run app store tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/stores/appStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit store lifecycle**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/stores/appStore.ts node-shell/apps/desktop/renderer-src/src/stores/appStore.test.ts
git commit -m "Add packages CSV export lifecycle"
```

---

### Task 6: App Shell Modal, Spinner, And AnalysisTabs Integration

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
- Modify: `node-shell/apps/desktop/test/electron-gui-smoke.test.js`

- [ ] **Step 1: Update App tests for export state and modal**

In `node-shell/apps/desktop/renderer-src/src/App.test.tsx`, add actions:

```ts
exportPackagesCsv: vi.fn(() => Promise.resolve()),
dismissPackagesCsvExportDialog: vi.fn(),
```

Extend `createMockState`:

```ts
isExportingPackagesCsv: false,
packagesCsvExportRequestId: 0,
exportPackagesCsv: mockHarness.actions.exportPackagesCsv,
dismissPackagesCsvExportDialog: mockHarness.actions.dismissPackagesCsvExportDialog,
```

Update the mocked `AnalysisTabs` signature:

```tsx
AnalysisTabs: ({
  isExportingPackagesCsv,
  isExtracting,
  onExportPackagesCsv,
  onDetailsSelectionChange,
  onExtractSelectedContainer,
  selectedFilePath,
  selectedPackageId,
  tableHeight,
}: {
  isExportingPackagesCsv: boolean;
  isExtracting: boolean;
  onExportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): void;
  onDetailsSelectionChange(selection: DetailSelection | null): void;
  onExtractSelectedContainer(): void;
  selectedFilePath: string;
  selectedPackageId: string;
  tableHeight: number;
}) => (
  <div
    data-exporting={isExportingPackagesCsv ? 'true' : 'false'}
    data-selected-package-id={selectedPackageId}
    data-testid="analysis-tabs"
    data-height={tableHeight}
  >
    <button type="button" onClick={() => onExportPackagesCsv([{
      id: '../../../Game/A.uasset',
      fullPath: '../../../Game/A.uasset',
      fileName: 'A.uasset',
      source: {},
    }], null)}>
      Export probe
    </button>
    <button
      data-extracting={isExtracting ? 'true' : 'false'}
      data-selected-file-path={selectedFilePath}
      type="button"
      onClick={onExtractSelectedContainer}
    >
      Extract probe
    </button>
    <button
      type="button"
      onClick={() => onDetailsSelectionChange({
        kind: 'package',
        row: {
          id: '../../../Engine/Config/Base.ini',
          fullPath: '../../../Engine/Config/Base.ini',
          fileName: 'Base.ini',
          physicalOrder: 0,
          source: {},
        },
      })}
    >
      Select package detail
    </button>
  </div>
)
```

Add tests:

```ts
test('passes packages CSV export state and action to analysis tabs', () => {
  mockHarness.state = createMockState({
    isExportingPackagesCsv: true,
    analysisResult: {
      overview: { packageCount: 1 },
      packages: [{ packagePath: '../../../Game/A.uasset', order: 0 }],
    },
    selectedFilePath: 'C:\\Paks\\A.pak',
  });

  render(<App />);

  expect(screen.getByTestId('analysis-tabs')).toHaveAttribute('data-exporting', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Export probe' }));
  expect(mockHarness.actions.exportPackagesCsv).toHaveBeenCalledTimes(1);
});

test('renders and dismisses the packages CSV export result modal', () => {
  mockHarness.state = createMockState({
    dialog: {
      packagesCsvExport: {
        kind: 'success',
        title: 'CSV exported',
        message: 'D:\\Exports\\A.csv\n1 package exported.',
      },
    },
  });

  render(<App />);

  expect(screen.getByText('CSV exported')).toBeInTheDocument();
  expect(screen.getByText(/D:\\Exports\\A\.csv/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'OK' }));

  expect(mockHarness.actions.dismissPackagesCsvExportDialog).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run App tests and verify they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/App.test.tsx
```

Expected: FAIL because App does not pass export props or render the modal.

- [ ] **Step 3: Implement App shell changes**

In `node-shell/apps/desktop/renderer-src/src/App.tsx`, import Modal:

```ts
import { Button, Layout, Modal, Spin, Typography } from 'antd';
```

Read store state/actions:

```ts
const isExportingPackagesCsv = useAppStore((state) => state.isExportingPackagesCsv);
const exportPackagesCsv = useAppStore((state) => state.exportPackagesCsv);
const dismissPackagesCsvExportDialog = useAppStore((state) => state.dismissPackagesCsvExportDialog);
```

Update busy state:

```ts
const shellBusy = isOpeningDirectory || isAnalyzing || isExtracting || isExportingPackagesCsv;
```

Pass props to `AnalysisTabs`:

```tsx
<AnalysisTabs
  result={analysisResult}
  selectedFilePath={selectedFilePath}
  isExtracting={isExtracting}
  isExportingPackagesCsv={isExportingPackagesCsv}
  selectedPackageId={selectedPackageId}
  tableHeight={tableHeight}
  onDetailsSelectionChange={setDetailSelection}
  onExtractSelectedContainer={() => void extractSelectedContainer()}
  onExportPackagesCsv={(rows, sortState) => void exportPackagesCsv(rows, sortState)}
/>
```

Render modal near existing dialogs:

```tsx
<Modal
  open={Boolean(dialog.packagesCsvExport)}
  title={dialog.packagesCsvExport?.title}
  onCancel={dismissPackagesCsvExportDialog}
  onOk={dismissPackagesCsvExportDialog}
  cancelButtonProps={{ style: { display: 'none' } }}
>
  <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>
    {dialog.packagesCsvExport?.message}
  </Typography.Text>
</Modal>
```

- [ ] **Step 4: Update smoke test expected text**

In `node-shell/apps/desktop/test/electron-gui-smoke.test.js`, update:

```js
for (const expectedText of ['Overview', 'Packages', 'Issues', 'Opened containers', 'Details', 'Export CSV...']) {
  assert.match(visibleText, new RegExp(expectedText));
}
```

- [ ] **Step 5: Run App and AnalysisTabs tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/App.test.tsx apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit app shell integration**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx node-shell/apps/desktop/test/electron-gui-smoke.test.js
git commit -m "Add packages CSV export UI"
```

---

### Task 7: Full Verification And Local Real-Asset Acceptance

**Files:**
- No required source edits in this task.

- [ ] **Step 1: Run all node and renderer tests**

Run:

```powershell
npm.cmd --prefix node-shell test
```

Expected: PASS.

- [ ] **Step 2: Run a fresh Electron GUI smoke test**

Run:

```powershell
npm.cmd --prefix node-shell run build:renderer
node --test node-shell/apps/desktop/test/electron-gui-smoke.test.js
```

Expected: PASS. The smoke must verify renderer mount, no runtime exceptions, `window.upi`, and visible `Export CSV...`.

- [ ] **Step 3: Verify shared CSV logic against local packaged demo assets**

Use the local asset directory explicitly:

```powershell
$assetDir = 'C:\WORKSPACE_Omni\AssetUpdate\Dist\Windows\AssetUpdateDemo\Content\Paks'
Get-ChildItem -LiteralPath $assetDir -File -Include *.pak,*.utoc,*.ucas | Select-Object Name,Length
```

Expected files include:

```text
AssetUpdateDemo-Windows.pak
AssetUpdateDemo-Windows.utoc
AssetUpdateDemo-Windows.ucas
global.utoc
global.ucas
```

Run CLI analysis on the Pak and IoStore selections to confirm the current backend can read them:

```powershell
npm.cmd --prefix node-shell run cli -- analyze "$assetDir\AssetUpdateDemo-Windows.pak"
npm.cmd --prefix node-shell run cli -- analyze "$assetDir\AssetUpdateDemo-Windows.utoc"
npm.cmd --prefix node-shell run cli -- analyze "$assetDir\global.utoc"
```

Expected: each command exits `0` and prints JSON with a `packages` array. If multiple compatible backends are reported, rerun each command with the first suggested `--backend-id`.

- [ ] **Step 4: Manually verify GUI export using the local demo assets**

Run:

```powershell
npm.cmd --prefix node-shell run gui
```

In the GUI:

1. Open `C:\WORKSPACE_Omni\AssetUpdate\Dist\Windows\AssetUpdateDemo\Content\Paks`.
2. Select `AssetUpdateDemo-Windows.pak`.
3. Go to Packages, keep Table mode, click `Export CSV...`.
4. Save to a temporary file such as `%TEMP%\AssetUpdateDemo-Windows.pak.packages.csv`.
5. Confirm the success modal includes the path and package count.
6. Repeat for `AssetUpdateDemo-Windows.utoc`.
7. Repeat for `global.utoc`.

Verify each exported file:

```powershell
$csv = Get-Content -LiteralPath "$env:TEMP\AssetUpdateDemo-Windows.pak.packages.csv" -Raw
$csv.StartsWith([char]0xFEFF)
$csv -split "`r`n" | Select-Object -First 3
```

Expected:

- first expression prints `True`,
- first visible line is `Full Path,Size,Compressed,Order`,
- package rows use raw numeric values,
- row count equals the success modal count plus one header line,
- no GUI export failure is added to the Issues tab.

- [ ] **Step 5: Record verification in the final response**

Include:

- `npm.cmd --prefix node-shell test` result,
- Electron GUI smoke result,
- which local asset files were used,
- where CSV files were written,
- whether CSV header, BOM, row count, and modal count matched.

- [ ] **Step 6: Confirm verification did not create source edits**

Run:

```powershell
git status --short
```

Expected: no new source edits from Task 7. If verification reveals a source or test defect, return to the task that owns that file, add a failing test there, make the smallest fix, rerun the relevant test command, and commit that concrete fix with the file paths named by `git status --short`.

---

## Self-Review Notes

- Spec coverage: the plan covers Table-only export, Tree disabled, current table row order, raw values, header row, standard CSV escaping, UTF-8 BOM, Save dialog, success/failure modals, no Issues tab mutation, shared CLI-ready logic, no native/protocol changes, Electron GUI smoke, and local demo asset acceptance.
- Placeholder scan: the plan contains concrete file paths, code snippets, commands, and expected results.
- Type consistency: `PackageRow`, `PackageTableSortState`, `PackagesCsvSavePathResult`, and `PackagesCsvWriteResult` are introduced before use in renderer/store tasks.
