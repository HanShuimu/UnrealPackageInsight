# UPI Final UI Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the UPI Final renderer contract so the desktop GUI shows only the designed tabs, defaults to Overview, renders Packages as a table/tree with complete fixed paths and sortable numeric/order columns, and makes Opened containers adaptive and draggable.

**Architecture:** Add explicit renderer view-model helpers that normalize backend analysis data before it reaches React components. Replace generic tab/table generation with UPI Final components for Overview, Packages, Issues, Details, and the resizable left pane while keeping the existing store and IPC flow intact.

**Tech Stack:** React 19, TypeScript, Ant Design 6, Zustand, Vitest, Testing Library, Electron with DevTools Protocol smoke verification.

---

## Design Source

Use `docs/superpowers/specs/2026-06-22-upi-final-ui-contract-design.md` as the contract. The user-approved deltas that must be honored during execution are:

- Top-level analysis tabs are exactly `Overview`, `Packages`, and `Issues`.
- Completed analysis always starts on `Overview`; `Issues` is never auto-selected.
- `Packages` has `Table` and `Tree`, with `Table` active by default.
- `Packages Table` defaults to file-name sorting and supports sorting by size, compressed size, and physical order.
- The visible path column is `Full Path`, fixed left, single-line, complete, not ellipsized, and always visible during horizontal scrolling.
- `Overview` keeps only real top statistic cards; no size-breakdown section.
- Empty `Details` shows only the title `Details`.
- `Opened containers` starts wide enough for deep trees when space allows, is draggable from the right boundary, and does not persist the dragged width.

## File Structure

- Create `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`: UPI Final data contract, package normalization, overview cards, issue rows, package tree model, and sort helpers.
- Create `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`: Pure view-model regression tests.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts`: Keep legacy import path but return only the UPI Final tab contract.
- Modify `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts`: Assert the three-tab contract for Pak, IoStore, issue-only, empty, and unknown results.
- Create `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`: UPI Final package table with fixed `Full Path` column and sortable design columns.
- Create `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`: Column contract, default row order, table scroll, and selection tests.
- Create `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.tsx`: Package-content tree built from package paths.
- Create `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx`: Hierarchy rendering and selection tests.
- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`: Controlled top-level tab state, package mode switch, Overview cards, Issues table, and selection callbacks.
- Modify `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`: New rendering contract and reset behavior.
- Create `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`: Details title-only empty state and real selection details.
- Create `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`: Empty, package, tree item, and issue detail rendering.
- Create `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.ts`: Width estimation, clamping, and no-persistence pane state helpers.
- Create `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts`: Adaptive width and clamp tests.
- Modify `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts`: Add tree depth/label helpers and full path titles for filesystem nodes.
- Modify `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts`: Tree depth, supported label width input, and title regression tests.
- Modify `node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx`: Keep full titles available and preserve expanded supported-file visibility.
- Modify `node-shell/apps/desktop/renderer-src/src/App.tsx`: Use resizable grid columns, clear Details on result/file change, and pass selection callbacks.
- Modify `node-shell/apps/desktop/renderer-src/src/App.test.tsx`: Pane resize behavior, Details empty state, and no local persistence.
- Modify `node-shell/apps/desktop/renderer-src/src/styles.css`: Fixed path column styling, package mode layout, resizer, Details cleanup, and adaptive pane layout.
- Create `node-shell/apps/desktop/test/electron-gui-smoke.test.js`: Launch Electron with DevTools Protocol and verify the renderer.

## Common Commands

- Run one renderer test file:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

- Run all renderer checks:

```powershell
npm.cmd --prefix node-shell run test:renderer
```

- Run all repository checks used by the node shell:

```powershell
npm.cmd --prefix node-shell test
```

- Run Electron GUI smoke after implementation:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

## Task 1: View-Model Contract

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts`

- [ ] **Step 1: Write the failing view-model tests**

Replace `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts` with:

```ts
import { describe, expect, test } from 'vitest';
import type { AnalysisResult } from '../types/upi';
import {
  ANALYSIS_TABS,
  buildAnalysisViewModel,
  buildIssueRows,
  buildOverviewCards,
  buildPackageRows,
  buildPackageTree,
  comparePackageFileName,
  comparePackageOrder,
} from './analysisViewModel';

const pakResult: AnalysisResult = {
  overview: { totalSize: 4300, packageCount: 2, unusedField: undefined },
  packages: [
    { packagePath: '../../../Game/Zeta/Beta.uasset', size: 3000, compressedSize: 1200, order: 8 },
    { packagePath: '../../../Engine/Config/Base.ini', size: 1300, compressedSize: 900, order: 1 },
  ],
  compressedBlocks: [{ id: 1 }],
  chunks: [{ id: 2 }],
  partitions: [{ id: 3 }],
  issues: [{ severity: 'warning', code: 'W001', message: 'Missing optional summary' }],
};

describe('analysisViewModel', () => {
  test('exposes only the UPI Final tabs for any analysis result', () => {
    expect(ANALYSIS_TABS.map((tab) => tab.id)).toEqual(['overview', 'packages', 'issues']);
    expect(buildAnalysisViewModel(pakResult).tabs.map((tab) => tab.label)).toEqual([
      'Overview',
      'Packages',
      'Issues',
    ]);
    expect(buildAnalysisViewModel({ issues: [{ message: 'Only issue' }] }).tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'packages',
      'issues',
    ]);
    expect(buildAnalysisViewModel(null).tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'packages',
      'issues',
    ]);
  });

  test('builds Overview cards from real values only', () => {
    expect(buildOverviewCards(pakResult)).toEqual([
      { id: 'packageCount', label: 'Packages', value: '2' },
      { id: 'totalSize', label: 'Total Size', value: '4.20 KB' },
      { id: 'compressedSize', label: 'Compressed Size', value: '2.05 KB' },
      { id: 'issueCount', label: 'Issues', value: '1' },
    ]);
    expect(buildOverviewCards({ overview: {}, packages: [], issues: [] })).toEqual([
      { id: 'packageCount', label: 'Packages', value: '0' },
      { id: 'issueCount', label: 'Issues', value: '0' },
    ]);
  });

  test('normalizes package rows and defaults to file-name order', () => {
    const rows = buildPackageRows(pakResult);
    expect(rows.map((row) => row.fileName)).toEqual(['Base.ini', 'Beta.uasset']);
    expect(rows[0]).toMatchObject({
      id: '../../../Engine/Config/Base.ini',
      fullPath: '../../../Engine/Config/Base.ini',
      fileName: 'Base.ini',
      size: 1300,
      compressedSize: 900,
      physicalOrder: 1,
    });
  });

  test('sort helpers support file name and physical order', () => {
    const rows = buildPackageRows(pakResult);
    expect([...rows].sort(comparePackageFileName).map((row) => row.fileName)).toEqual(['Base.ini', 'Beta.uasset']);
    expect([...rows].sort(comparePackageOrder).map((row) => row.physicalOrder)).toEqual([1, 8]);
  });

  test('builds a package-content tree from package paths', () => {
    expect(buildPackageTree(buildPackageRows(pakResult))).toEqual([
      {
        key: '../../../Engine',
        title: 'Engine',
        children: [
          {
            key: '../../../Engine/Config',
            title: 'Config',
            children: [
              {
                key: '../../../Engine/Config/Base.ini',
                title: 'Base.ini',
                packageRowId: '../../../Engine/Config/Base.ini',
              },
            ],
          },
        ],
      },
      {
        key: '../../../Game',
        title: 'Game',
        children: [
          {
            key: '../../../Game/Zeta',
            title: 'Zeta',
            children: [
              {
                key: '../../../Game/Zeta/Beta.uasset',
                title: 'Beta.uasset',
                packageRowId: '../../../Game/Zeta/Beta.uasset',
              },
            ],
          },
        ],
      },
    ]);
  });

  test('normalizes Issues to design-approved fields', () => {
    expect(buildIssueRows(pakResult)).toEqual([
      {
        id: 'W001::0',
        severity: 'warning',
        code: 'W001',
        message: 'Missing optional summary',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts
```

Expected: FAIL because `./analysisViewModel` does not exist.

- [ ] **Step 3: Implement `analysisViewModel.ts`**

Create `node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts`:

```ts
import type { AnalysisResult, Issue } from '../types/upi';

export type AnalysisTabId = 'overview' | 'packages' | 'issues';
export type PackageMode = 'table' | 'tree';

export type AnalysisTabModel = {
  id: AnalysisTabId;
  label: 'Overview' | 'Packages' | 'Issues';
};

export type OverviewCard = {
  id: 'packageCount' | 'totalSize' | 'compressedSize' | 'issueCount';
  label: string;
  value: string;
};

export type PackageRow = {
  id: string;
  fullPath: string;
  fileName: string;
  type: string;
  size: number | null;
  compressedSize: number | null;
  physicalOrder: number | null;
  source: Record<string, unknown>;
};

export type PackageTreeItem = {
  key: string;
  title: string;
  packageRowId?: string;
  children?: PackageTreeItem[];
};

export type IssueRow = {
  id: string;
  severity: string;
  code: string;
  message: string;
  source: Issue;
};

export type DetailSelection =
  | { kind: 'package'; row: PackageRow }
  | { kind: 'issue'; row: IssueRow };

export type AnalysisViewModel = {
  tabs: AnalysisTabModel[];
  overviewCards: OverviewCard[];
  packageRows: PackageRow[];
  packageTree: PackageTreeItem[];
  issueRows: IssueRow[];
};

export const ANALYSIS_TABS: AnalysisTabModel[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'packages', label: 'Packages' },
  { id: 'issues', label: 'Issues' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function packagePath(record: Record<string, unknown>): string {
  return asString(record.packagePath || record.path || record.fullPath || record.relativePath || record.name);
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || value;
}

function packageType(value: string): string {
  const name = basename(value);
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toUpperCase() : 'Package';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = value;
  let unitIndex = 0;

  while (Math.abs(nextValue) >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${nextValue} ${units[unitIndex]}` : `${nextValue.toFixed(2)} ${units[unitIndex]}`;
}

function sumNumbers(rows: PackageRow[], selector: (row: PackageRow) => number | null): number | null {
  let hasValue = false;
  const total = rows.reduce((sum, row) => {
    const value = selector(row);
    if (value === null) {
      return sum;
    }

    hasValue = true;
    return sum + value;
  }, 0);

  return hasValue ? total : null;
}

export function comparePackageFileName(left: PackageRow, right: PackageRow): number {
  return left.fileName.localeCompare(right.fileName, undefined, { numeric: true, sensitivity: 'base' })
    || left.fullPath.localeCompare(right.fullPath, undefined, { numeric: true, sensitivity: 'base' });
}

export function comparePackageOrder(left: PackageRow, right: PackageRow): number {
  const leftOrder = left.physicalOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.physicalOrder ?? Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || comparePackageFileName(left, right);
}

export function buildPackageRows(result: AnalysisResult | null): PackageRow[] {
  const packages = Array.isArray(result?.packages) ? result.packages : [];

  const sortedRows = packages
    .filter(isRecord)
    .map((record) => {
      const fullPath = packagePath(record);
      const row: PackageRow = {
        id: fullPath,
        fullPath,
        fileName: basename(fullPath),
        type: packageType(fullPath),
        size: asNumber(record.size ?? record.diskSize),
        compressedSize: asNumber(record.compressedSize),
        physicalOrder: asNumber(record.order ?? record.physicalOrder),
        source: record,
      };

      return row;
    })
    .filter((row) => row.fullPath)
    .sort(comparePackageFileName);

  const emittedIds = new Map<string, number>();

  return sortedRows.map((row) => {
    const count = emittedIds.get(row.fullPath) ?? 0;
    emittedIds.set(row.fullPath, count + 1);
    return {
      ...row,
      id: count === 0 ? row.fullPath : `${row.fullPath}::${count}`,
    };
  });
}

export function buildOverviewCards(result: AnalysisResult | null): OverviewCard[] {
  const packageRows = buildPackageRows(result);
  const overview = isRecord(result?.overview) ? result.overview : {};
  const cards: OverviewCard[] = [];
  const packageCount = asNumber(overview.packageCount) ?? packageRows.length;
  const totalSize = asNumber(overview.totalSize) ?? sumNumbers(packageRows, (row) => row.size);
  const compressedSize = sumNumbers(packageRows, (row) => row.compressedSize);
  const issueCount = Array.isArray(result?.issues) ? result.issues.length : 0;

  cards.push({ id: 'packageCount', label: 'Packages', value: String(packageCount) });

  if (totalSize !== null) {
    cards.push({ id: 'totalSize', label: 'Total Size', value: formatBytes(totalSize) });
  }

  if (compressedSize !== null) {
    cards.push({ id: 'compressedSize', label: 'Compressed Size', value: formatBytes(compressedSize) });
  }

  cards.push({ id: 'issueCount', label: 'Issues', value: String(issueCount) });

  return cards;
}

export function buildIssueRows(result: AnalysisResult | null): IssueRow[] {
  const issues = Array.isArray(result?.issues) ? result.issues : [];

  return issues.map((issue, index) => {
    const code = asString(issue.code);
    return {
      id: `${code || issue.message || 'issue'}::${index}`,
      severity: asString(issue.severity),
      code,
      message: asString(issue.message),
      source: issue,
    };
  });
}

function insertTreePath(root: PackageTreeItem[], row: PackageRow): void {
  const pathParts = row.fullPath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '..');
  let siblings = root;
  let keyPrefix = row.fullPath.startsWith('../') ? '../../..' : '';

  pathParts.forEach((part, index) => {
    const key = keyPrefix ? `${keyPrefix}/${part}` : part;
    let node = siblings.find((candidate) => candidate.key === key);
    const isLeaf = index === pathParts.length - 1;

    if (!node) {
      node = {
        key,
        title: part,
        ...(isLeaf ? { packageRowId: row.id } : { children: [] }),
      };
      siblings.push(node);
      siblings.sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' }));
    }

    if (!isLeaf) {
      node.children ??= [];
      siblings = node.children;
    }

    keyPrefix = key;
  });
}

export function buildPackageTree(rows: PackageRow[]): PackageTreeItem[] {
  const root: PackageTreeItem[] = [];
  rows.forEach((row) => insertTreePath(root, row));
  return root;
}

export function buildAnalysisViewModel(result: AnalysisResult | null): AnalysisViewModel {
  const packageRows = buildPackageRows(result);

  return {
    tabs: ANALYSIS_TABS,
    overviewCards: buildOverviewCards(result),
    packageRows,
    packageTree: buildPackageTree(packageRows),
    issueRows: buildIssueRows(result),
  };
}
```

- [ ] **Step 4: Keep `analysisTabs.ts` as a compatibility shim**

Replace `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts` with:

```ts
import type { AnalysisResult } from '../types/upi';
import { ANALYSIS_TABS, type AnalysisTabModel } from './analysisViewModel';

export type { AnalysisTabModel };

export function buildAnalysisTabs(_result: AnalysisResult | null): AnalysisTabModel[] {
  return ANALYSIS_TABS;
}
```

- [ ] **Step 5: Replace the legacy tab tests**

Replace `node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts` with:

```ts
import { describe, expect, test } from 'vitest';
import { buildAnalysisTabs } from './analysisTabs';

describe('buildAnalysisTabs', () => {
  test('always returns the UPI Final top-level tabs', () => {
    const cases = [
      null,
      { packages: [], compressedBlocks: [], issues: [] },
      { chunks: [], partitions: [], compressedBlocks: [], packages: [], issues: [] },
      { issues: [{ message: 'Issue only' }] },
      { unknownBackendField: [{ id: 1 }] },
    ];

    cases.forEach((result) => {
      expect(buildAnalysisTabs(result).map((tab) => tab.id)).toEqual(['overview', 'packages', 'issues']);
    });
  });
});
```

- [ ] **Step 6: Run the view-model tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts apps/desktop/renderer-src/src/utils/analysisTabs.test.ts
```

Expected: PASS for both files.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.ts node-shell/apps/desktop/renderer-src/src/utils/analysisViewModel.test.ts node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.ts node-shell/apps/desktop/renderer-src/src/utils/analysisTabs.test.ts
git commit -m "Add UPI Final analysis view model"
```

Expected: commit succeeds and includes only the four files listed above.

## Task 2: Packages Table

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Write the failing package table tests**

Create `node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ColumnsType } from 'antd/es/table';
import type { PackageRow } from '../utils/analysisViewModel';
import { PackageTable } from './PackageTable';

const tableHarness = vi.hoisted(() => ({
  props: null as null | {
    columns: ColumnsType<PackageRow>;
    dataSource: PackageRow[];
    onRow?: (row: PackageRow) => React.HTMLAttributes<HTMLElement>;
    scroll?: { x?: number | string; y?: number };
    tableLayout?: string;
  },
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Table: (props: typeof tableHarness.props) => {
      tableHarness.props = props;
      return (
        <div data-testid="mock-package-table" data-scroll-x={String(props?.scroll?.x)} data-scroll-y={String(props?.scroll?.y)}>
          {props?.dataSource.map((row) => (
            <button key={row.id} onClick={() => props.onRow?.(row).onClick?.({} as React.MouseEvent<HTMLElement>)}>
              {row.fullPath}
            </button>
          ))}
        </div>
      );
    },
  };
});

const rows: PackageRow[] = [
  {
    id: 'beta',
    fullPath: '../../../Game/Zeta/Beta.uasset',
    fileName: 'Beta.uasset',
    type: 'UASSET',
    size: 3000,
    compressedSize: 1200,
    physicalOrder: 8,
    source: {},
  },
  {
    id: 'base',
    fullPath: '../../../Engine/Config/Base.ini',
    fileName: 'Base.ini',
    type: 'INI',
    size: 1300,
    compressedSize: 900,
    physicalOrder: 1,
    source: {},
  },
];

describe('PackageTable', () => {
  test('keeps Full Path as the fixed left primary column with no ellipsis', () => {
    render(<PackageTable rows={rows} height={400} onSelectPackage={vi.fn()} />);

    const firstColumn = tableHarness.props?.columns[0];
    expect(firstColumn).toMatchObject({
      dataIndex: 'fullPath',
      ellipsis: false,
      fixed: 'left',
      key: 'fullPath',
      title: 'Full Path',
      width: 520,
    });
    expect(firstColumn?.className).toBe('package-path-column');
    expect(tableHarness.props?.scroll).toEqual({ x: 980, y: 400 });
    expect(tableHarness.props?.tableLayout).toBe('auto');
  });

  test('sorts rows by package file name before rendering', () => {
    render(<PackageTable rows={rows} height={320} onSelectPackage={vi.fn()} />);

    expect(tableHarness.props?.dataSource.map((row) => row.fileName)).toEqual(['Base.ini', 'Beta.uasset']);
  });

  test('exposes size, compressed size, and physical order sorters', () => {
    render(<PackageTable rows={rows} height={320} onSelectPackage={vi.fn()} />);

    const columns = tableHarness.props?.columns ?? [];
    expect(columns.find((column) => column.key === 'size')?.sorter).toBeTypeOf('function');
    expect(columns.find((column) => column.key === 'compressedSize')?.sorter).toBeTypeOf('function');
    expect(columns.find((column) => column.key === 'physicalOrder')?.sorter).toBeTypeOf('function');
  });

  test('selects a row for Details', () => {
    const onSelectPackage = vi.fn();
    render(<PackageTable rows={rows} height={320} onSelectPackage={onSelectPackage} />);

    fireEvent.click(screen.getByRole('button', { name: '../../../Engine/Config/Base.ini' }));

    expect(onSelectPackage).toHaveBeenCalledWith(expect.objectContaining({ id: 'base' }));
  });
});
```

- [ ] **Step 2: Run the package table test and confirm it fails**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx
```

Expected: FAIL because `PackageTable.tsx` does not exist.

- [ ] **Step 3: Implement `PackageTable.tsx`**

Create `node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx`:

```tsx
import { Empty, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import type { PackageRow } from '../utils/analysisViewModel';
import { comparePackageFileName } from '../utils/analysisViewModel';

type PackageTableProps = {
  rows: PackageRow[];
  height: number;
  onSelectPackage(row: PackageRow): void;
};

function formatBytes(value: number | null): string {
  if (value === null) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let nextValue = value;
  let unitIndex = 0;

  while (Math.abs(nextValue) >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${nextValue} ${units[unitIndex]}` : `${nextValue.toFixed(2)} ${units[unitIndex]}`;
}

function numberValue(value: number | null): number {
  return value ?? Number.MAX_SAFE_INTEGER;
}

export function PackageTable({ rows, height, onSelectPackage }: PackageTableProps) {
  const dataSource = useMemo(() => [...rows].sort(comparePackageFileName), [rows]);
  const columns = useMemo<ColumnsType<PackageRow>>(() => [
    {
      className: 'package-path-column',
      dataIndex: 'fullPath',
      ellipsis: false,
      fixed: 'left',
      key: 'fullPath',
      render: (value: string) => (
        <span className="package-path-cell" title={value}>
          {value}
        </span>
      ),
      sorter: comparePackageFileName,
      title: 'Full Path',
      width: 520,
    },
    {
      dataIndex: 'size',
      key: 'size',
      render: formatBytes,
      sorter: (left, right) => numberValue(left.size) - numberValue(right.size),
      title: 'Size',
      width: 120,
    },
    {
      dataIndex: 'compressedSize',
      key: 'compressedSize',
      render: formatBytes,
      sorter: (left, right) => numberValue(left.compressedSize) - numberValue(right.compressedSize),
      title: 'Compressed',
      width: 140,
    },
    {
      dataIndex: 'physicalOrder',
      key: 'physicalOrder',
      render: (value: number | null) => value ?? '',
      sorter: (left, right) => numberValue(left.physicalOrder) - numberValue(right.physicalOrder),
      title: 'Order',
      width: 100,
    },
    {
      dataIndex: 'type',
      key: 'type',
      title: 'Type',
      width: 100,
    },
  ], []);

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
      scroll={{ x: 980, y: height }}
      size="small"
      tableLayout="auto"
      virtual
      onRow={(row) => ({
        onClick: () => onSelectPackage(row),
      })}
    />
  );
}
```

- [ ] **Step 4: Add table path styling**

Append these rules to the table section of `node-shell/apps/desktop/renderer-src/src/styles.css`:

```css
.analysis-table-pane .package-path-column,
.analysis-table-pane .package-path-cell {
  white-space: nowrap;
}

.analysis-table-pane .package-path-cell {
  display: inline-block;
  min-width: max-content;
  overflow: visible;
  text-overflow: clip;
}

.analysis-table-pane .ant-table-cell-fix-left.package-path-column {
  background: #ffffff;
}

.analysis-table-pane .ant-table-thead .ant-table-cell-fix-left.package-path-column {
  background: #eef3f8;
}
```

- [ ] **Step 5: Run the package table test**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageTable.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/components/PackageTable.tsx node-shell/apps/desktop/renderer-src/src/components/PackageTable.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Add UPI Final package table"
```

Expected: commit succeeds and includes only the three files listed above.

## Task 3: Packages Tree

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx`

- [ ] **Step 1: Write the failing package-content tree tests**

Create `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PackageRow, PackageTreeItem } from '../utils/analysisViewModel';
import { PackageContentTree } from './PackageContentTree';

const treeHarness = vi.hoisted(() => ({
  props: null as null | {
    treeData: PackageTreeItem[];
    onSelect?: (keys: React.Key[]) => void;
    selectedKeys?: React.Key[];
  },
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Tree: (props: typeof treeHarness.props) => {
      treeHarness.props = props;
      const leaf = props?.treeData[0]?.children?.[0]?.children?.[0];
      return (
        <button data-testid="mock-package-tree" onClick={() => props?.onSelect?.([leaf?.key ?? ''])}>
          {leaf?.title}
        </button>
      );
    },
  };
});

const row: PackageRow = {
  id: 'base',
  fullPath: '../../../Engine/Config/Base.ini',
  fileName: 'Base.ini',
  type: 'INI',
  size: 1300,
  compressedSize: 900,
  physicalOrder: 1,
  source: {},
};

describe('PackageContentTree', () => {
  test('renders a package-content hierarchy and selects package rows', () => {
    const onSelectPackage = vi.fn();

    render(<PackageContentTree rows={[row]} height={300} selectedPackageId="" onSelectPackage={onSelectPackage} />);

    expect(treeHarness.props?.treeData).toEqual([
      {
        key: '../../../Engine',
        title: 'Engine',
        children: [
          {
            key: '../../../Engine/Config',
            title: 'Config',
            children: [
              {
                key: '../../../Engine/Config/Base.ini',
                title: 'Base.ini',
                packageRowId: 'base',
              },
            ],
          },
        ],
      },
    ]);

    fireEvent.click(screen.getByTestId('mock-package-tree'));
    expect(onSelectPackage).toHaveBeenCalledWith(row);
  });

  test('shows an empty tree state when no package rows exist', () => {
    render(<PackageContentTree rows={[]} height={300} selectedPackageId="" onSelectPackage={vi.fn()} />);

    expect(screen.getByText('No packages to show.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tree test and confirm it fails**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx
```

Expected: FAIL because `PackageContentTree.tsx` does not exist.

- [ ] **Step 3: Implement `PackageContentTree.tsx`**

Create `node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.tsx`:

```tsx
import { Empty, Tree } from 'antd';
import type { Key } from 'react';
import { useCallback, useMemo } from 'react';
import type { PackageRow } from '../utils/analysisViewModel';
import { buildPackageTree } from '../utils/analysisViewModel';

type PackageContentTreeProps = {
  rows: PackageRow[];
  height: number;
  selectedPackageId: string;
  onSelectPackage(row: PackageRow): void;
};

function collectPackageKeys(nodes: ReturnType<typeof buildPackageTree>, keys: string[] = []): string[] {
  nodes.forEach((node) => {
    if (node.packageRowId) {
      keys.push(node.key);
    }

    if (node.children) {
      collectPackageKeys(node.children, keys);
    }
  });

  return keys;
}

export function PackageContentTree({ rows, height, selectedPackageId, onSelectPackage }: PackageContentTreeProps) {
  const treeData = useMemo(() => buildPackageTree(rows), [rows]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const keyToRowId = useMemo(() => {
    const pairs = new Map<string, string>();
    const visit = (nodes: typeof treeData) => {
      nodes.forEach((node) => {
        if (node.packageRowId) {
          pairs.set(node.key, node.packageRowId);
        }

        if (node.children) {
          visit(node.children);
        }
      });
    };
    visit(treeData);
    return pairs;
  }, [treeData]);

  const selectedKeys = useMemo(() => {
    if (!selectedPackageId) {
      return [];
    }

    return Array.from(keyToRowId.entries())
      .filter(([, rowId]) => rowId === selectedPackageId)
      .map(([key]) => key);
  }, [keyToRowId, selectedPackageId]);

  const handleSelect = useCallback((keys: Key[]) => {
    const rowId = keyToRowId.get(String(keys[0] || ''));
    const row = rowId ? rowById.get(rowId) : undefined;
    if (row) {
      onSelectPackage(row);
    }
  }, [keyToRowId, onSelectPackage, rowById]);

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No packages to show." />;
  }

  return (
    <Tree
      blockNode
      defaultExpandAll
      defaultExpandedKeys={collectPackageKeys(treeData)}
      height={height}
      selectedKeys={selectedKeys}
      treeData={treeData}
      virtual
      onSelect={handleSelect}
    />
  );
}
```

- [ ] **Step 4: Run the package-content tree test**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.tsx node-shell/apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx
git commit -m "Add package content tree"
```

Expected: commit succeeds and includes only the two files listed above.

## Task 4: Analysis Tabs Integration

**Files:**
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Replace `AnalysisTabs` tests with the UPI Final contract**

Replace `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx` with:

```tsx
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AnalysisTabs } from './AnalysisTabs';

type TabItem = {
  children?: React.ReactNode;
  key: string;
  label: React.ReactNode;
};

const tabHarness = vi.hoisted(() => ({
  activeKey: '',
  onChange: undefined as undefined | ((key: string) => void),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Segmented: ({ onChange, options, value }: { onChange?: (value: string) => void; options: string[]; value: string }) => (
      <div>
        {options.map((option) => (
          <button aria-pressed={value === option} key={option} onClick={() => onChange?.(option)}>
            {option}
          </button>
        ))}
      </div>
    ),
    Tabs: ({ activeKey, items, onChange }: { activeKey?: string; items?: TabItem[]; onChange?: (key: string) => void }) => {
      tabHarness.activeKey = activeKey || '';
      tabHarness.onChange = onChange;
      return (
        <div>
          <nav>
            {items?.map((item) => (
              <button key={item.key} onClick={() => onChange?.(item.key)}>
                {item.label}
              </button>
            ))}
          </nav>
          {items?.find((item) => item.key === activeKey)?.children}
        </div>
      );
    },
  };
});

vi.mock('./PackageTable', () => ({
  PackageTable: ({ onSelectPackage, rows }: { onSelectPackage(row: unknown): void; rows: unknown[] }) => (
    <button data-testid="package-table" onClick={() => onSelectPackage(rows[0])}>
      package table {rows.length}
    </button>
  ),
}));

vi.mock('./PackageContentTree', () => ({
  PackageContentTree: ({ rows }: { rows: unknown[] }) => <div data-testid="package-content-tree">package tree {rows.length}</div>,
}));

const result = {
  overview: { totalSize: 1300, packageCount: 1 },
  packages: [{ packagePath: '../../../Engine/Config/Base.ini', size: 1300, compressedSize: 900, order: 1 }],
  compressedBlocks: [{ id: 1 }],
  chunks: [{ id: 2 }],
  issues: [],
};

describe('AnalysisTabs', () => {
  beforeEach(() => {
    tabHarness.activeKey = '';
    tabHarness.onChange = undefined;
  });

  test('renders only Overview, Packages, and Issues without old filler copy', () => {
    render(<AnalysisTabs result={result} tableHeight={500} selectedPackageId="" onDetailsSelectionChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Packages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
    expect(screen.queryByText('Chunks')).not.toBeInTheDocument();
    expect(screen.queryByText('Partitions')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw')).not.toBeInTheDocument();
    expect(screen.queryByText('Tab content region')).not.toBeInTheDocument();
    expect(screen.queryByText('Replace with Pak or IoStore tab variants')).not.toBeInTheDocument();
  });

  test('defaults and resets to Overview when analysis result changes', () => {
    const { rerender } = render(
      <AnalysisTabs result={result} tableHeight={500} selectedPackageId="" onDetailsSelectionChange={vi.fn()} />,
    );

    expect(tabHarness.activeKey).toBe('overview');

    act(() => tabHarness.onChange?.('issues'));
    expect(tabHarness.activeKey).toBe('issues');

    rerender(
      <AnalysisTabs
        result={{ ...result, packages: [{ packagePath: '../../../Game/A.uasset' }] }}
        tableHeight={500}
        selectedPackageId=""
        onDetailsSelectionChange={vi.fn()}
      />,
    );

    expect(tabHarness.activeKey).toBe('overview');
  });

  test('shows package Table by default and can switch to Tree', async () => {
    const user = userEvent.setup();
    render(<AnalysisTabs result={result} tableHeight={500} selectedPackageId="" onDetailsSelectionChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Packages' }));
    expect(screen.getByTestId('package-table')).toHaveTextContent('package table 1');

    await user.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByTestId('package-content-tree')).toHaveTextContent('package tree 1');
  });

  test('renders Overview cards only and no size breakdown heading', () => {
    render(<AnalysisTabs result={result} tableHeight={500} selectedPackageId="" onDetailsSelectionChange={vi.fn()} />);

    expect(screen.getByText('Packages')).toBeInTheDocument();
    expect(screen.getByText('Total Size')).toBeInTheDocument();
    expect(screen.queryByText('Size Breakdown')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new AnalysisTabs test and confirm it fails**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx
```

Expected: FAIL because the component still has old props and old rendering.

- [ ] **Step 3: Replace `AnalysisTabs.tsx` with the UPI Final implementation**

Replace `node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx` with:

```tsx
import { Empty, Segmented, Table, Tabs, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState, type RefCallback } from 'react';
import type { AnalysisResult } from '../types/upi';
import {
  buildAnalysisViewModel,
  type DetailSelection,
  type IssueRow,
  type PackageMode,
  type PackageRow,
} from '../utils/analysisViewModel';
import { PackageContentTree } from './PackageContentTree';
import { PackageTable } from './PackageTable';

type AnalysisTabsProps = {
  result: AnalysisResult | null;
  selectedPackageId: string;
  tableHeight: number;
  onDetailsSelectionChange(selection: DetailSelection | null): void;
};

const TABLE_VERTICAL_CHROME_PX = 48;

function normalizeMeasuredHeight(height: number): number {
  return Math.max(0, Math.floor(height));
}

function readElementHeight(element: HTMLElement): number {
  return element.getBoundingClientRect().height || element.clientHeight || 0;
}

function useMeasuredHeight<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [element, setElement] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  const ref = useCallback((nextElement: T | null) => setElement(nextElement), []);

  useEffect(() => {
    if (!element) {
      setHeight(0);
      return undefined;
    }

    const updateHeight = (nextHeight: number) => {
      const measuredHeight = normalizeMeasuredHeight(nextHeight);
      setHeight((currentHeight) => (currentHeight === measuredHeight ? currentHeight : measuredHeight));
    };

    updateHeight(readElementHeight(element));

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateHeight(entry?.contentRect.height ?? readElementHeight(element));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, height];
}

function tableBodyHeight(availableHeight: number): number {
  return Math.max(0, normalizeMeasuredHeight(availableHeight) - TABLE_VERTICAL_CHROME_PX);
}

function OverviewPane({ cards }: { cards: ReturnType<typeof buildAnalysisViewModel>['overviewCards'] }) {
  if (cards.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No summary to show." />;
  }

  return (
    <div className="summary-grid">
      {cards.map((card) => (
        <div className="summary-card" key={card.id}>
          <Typography.Text className="summary-label">{card.label}</Typography.Text>
          <Typography.Text className="summary-value">{card.value}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

function PackagesPane({
  fallbackHeight,
  rows,
  selectedPackageId,
  onSelectPackage,
}: {
  fallbackHeight: number;
  rows: PackageRow[];
  selectedPackageId: string;
  onSelectPackage(row: PackageRow): void;
}) {
  const [paneRef, measuredHeight] = useMeasuredHeight<HTMLDivElement>();
  const [mode, setMode] = useState<PackageMode>('table');
  const height = tableBodyHeight(measuredHeight || fallbackHeight);

  return (
    <div className="analysis-table-pane package-pane" ref={paneRef}>
      <div className="package-mode-row">
        <Segmented
          options={['Table', 'Tree']}
          value={mode === 'table' ? 'Table' : 'Tree'}
          onChange={(value) => setMode(value === 'Tree' ? 'tree' : 'table')}
        />
      </div>
      <div className="package-mode-content">
        {mode === 'table' ? (
          <PackageTable rows={rows} height={height} onSelectPackage={onSelectPackage} />
        ) : (
          <PackageContentTree
            rows={rows}
            height={height}
            selectedPackageId={selectedPackageId}
            onSelectPackage={onSelectPackage}
          />
        )}
      </div>
    </div>
  );
}

function IssuesPane({
  fallbackHeight,
  issues,
  onSelectIssue,
}: {
  fallbackHeight: number;
  issues: IssueRow[];
  onSelectIssue(row: IssueRow): void;
}) {
  const [paneRef, measuredHeight] = useMeasuredHeight<HTMLDivElement>();
  const height = tableBodyHeight(measuredHeight || fallbackHeight);
  const columns: ColumnsType<IssueRow> = [
    { dataIndex: 'severity', key: 'severity', title: 'Severity', width: 120 },
    { dataIndex: 'code', key: 'code', title: 'Code', width: 120 },
    { dataIndex: 'message', key: 'message', title: 'Message' },
  ];

  return (
    <div className="analysis-table-pane" ref={paneRef}>
      <Table<IssueRow>
        bordered
        columns={columns}
        dataSource={issues}
        locale={{ emptyText: 'No issues to show.' }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 720, y: height }}
        size="small"
        virtual
        onRow={(row) => ({ onClick: () => onSelectIssue(row) })}
      />
    </div>
  );
}

export function AnalysisTabs({
  result,
  selectedPackageId,
  tableHeight,
  onDetailsSelectionChange,
}: AnalysisTabsProps) {
  const viewModel = useMemo(() => buildAnalysisViewModel(result), [result]);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setActiveTab('overview');
    onDetailsSelectionChange(null);
  }, [onDetailsSelectionChange, result]);

  const handleSelectPackage = useCallback((row: PackageRow) => {
    onDetailsSelectionChange({ kind: 'package', row });
  }, [onDetailsSelectionChange]);

  const handleSelectIssue = useCallback((row: IssueRow) => {
    onDetailsSelectionChange({ kind: 'issue', row });
  }, [onDetailsSelectionChange]);

  return (
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={viewModel.tabs.map((tab) => ({
        key: tab.id,
        label: tab.label,
        children: tab.id === 'overview'
          ? <OverviewPane cards={viewModel.overviewCards} />
          : tab.id === 'packages'
            ? (
              <PackagesPane
                fallbackHeight={tableHeight}
                rows={viewModel.packageRows}
                selectedPackageId={selectedPackageId}
                onSelectPackage={handleSelectPackage}
              />
            )
            : (
              <IssuesPane
                fallbackHeight={tableHeight}
                issues={viewModel.issueRows}
                onSelectIssue={handleSelectIssue}
              />
            ),
      }))}
    />
  );
}
```

- [ ] **Step 4: Add package mode layout styles**

Add to `node-shell/apps/desktop/renderer-src/src/styles.css` near `.analysis-table-pane`:

```css
.package-pane {
  display: flex;
  flex-direction: column;
}

.package-mode-row {
  display: flex;
  justify-content: flex-end;
  flex: 0 0 auto;
  padding-bottom: 12px;
}

.package-mode-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 5: Run AnalysisTabs tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx apps/desktop/renderer-src/src/components/PackageTable.test.tsx apps/desktop/renderer-src/src/components/PackageContentTree.test.tsx
```

Expected: PASS for all three files.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.tsx node-shell/apps/desktop/renderer-src/src/components/AnalysisTabs.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Wire UPI Final analysis tabs"
```

Expected: commit succeeds and includes only the three files listed above.

## Task 5: Details Pane

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`
- Create: `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Write DetailsPane tests**

Create `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { DetailSelection } from '../utils/analysisViewModel';
import { DetailsPane } from './DetailsPane';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Typography: {
      Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
      Title: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    },
  };
});

const packageSelection: DetailSelection = {
  kind: 'package',
  row: {
    id: 'base',
    fullPath: '../../../Engine/Config/Base.ini',
    fileName: 'Base.ini',
    type: 'INI',
    size: 1300,
    compressedSize: 900,
    physicalOrder: 1,
    source: {},
  },
};

const issueSelection: DetailSelection = {
  kind: 'issue',
  row: {
    id: 'W001::0',
    severity: 'warning',
    code: 'W001',
    message: 'Missing optional summary',
    source: { severity: 'warning', code: 'W001', message: 'Missing optional summary' },
  },
};

describe('DetailsPane', () => {
  test('empty state contains only the Details title', () => {
    const { container } = render(<DetailsPane selection={null} />);

    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(container.textContent).toBe('Details');
  });

  test('shows real package details after selecting a package row', () => {
    render(<DetailsPane selection={packageSelection} />);

    expect(screen.getByText('../../../Engine/Config/Base.ini')).toBeInTheDocument();
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  test('shows real issue details after selecting an issue row', () => {
    render(<DetailsPane selection={issueSelection} />);

    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('W001')).toBeInTheDocument();
    expect(screen.getByText('Missing optional summary')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run DetailsPane test and confirm it fails**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/DetailsPane.test.tsx
```

Expected: FAIL because `DetailsPane.tsx` does not exist.

- [ ] **Step 3: Implement `DetailsPane.tsx`**

Create `node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx`:

```tsx
import { Typography } from 'antd';
import type { DetailSelection } from '../utils/analysisViewModel';

type DetailsPaneProps = {
  selection: DetailSelection | null;
};

function formatNullable(value: number | string | null): string {
  return value === null ? '' : String(value);
}

function DetailRow({ label, value }: { label: string; value: number | string | null }) {
  const text = formatNullable(value);
  if (!text) {
    return null;
  }

  return (
    <div className="detail-row">
      <Typography.Text className="detail-label">{label}</Typography.Text>
      <Typography.Text className="detail-value" title={text}>{text}</Typography.Text>
    </div>
  );
}

export function DetailsPane({ selection }: DetailsPaneProps) {
  return (
    <section className="workspace-pane details-region" aria-label="Details">
      <div className="pane-title-block details-title-only">
        <Typography.Title className="pane-title" level={2}>
          Details
        </Typography.Title>
      </div>
      {selection?.kind === 'package' ? (
        <div className="detail-stack">
          <DetailRow label="Full Path" value={selection.row.fullPath} />
          <DetailRow label="File Name" value={selection.row.fileName} />
          <DetailRow label="Size" value={selection.row.size} />
          <DetailRow label="Compressed" value={selection.row.compressedSize} />
          <DetailRow label="Order" value={selection.row.physicalOrder} />
          <DetailRow label="Type" value={selection.row.type} />
        </div>
      ) : null}
      {selection?.kind === 'issue' ? (
        <div className="detail-stack">
          <DetailRow label="Severity" value={selection.row.severity} />
          <DetailRow label="Code" value={selection.row.code} />
          <DetailRow label="Message" value={selection.row.message} />
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Integrate DetailsPane in App**

Modify `node-shell/apps/desktop/renderer-src/src/App.tsx`:

```tsx
import { DetailsPane } from './components/DetailsPane';
import type { BackendInfo } from './types/upi';
import type { DetailSelection } from './utils/analysisViewModel';
```

Inside `App`, add:

```tsx
const [detailsSelection, setDetailsSelection] = useState<DetailSelection | null>(null);

useEffect(() => {
  setDetailsSelection(null);
}, [analysisResult, selectedFilePath]);
```

Replace the existing `<AnalysisTabs ... />` call with:

```tsx
<AnalysisTabs
  result={analysisResult}
  selectedPackageId={detailsSelection?.kind === 'package' ? detailsSelection.row.id : ''}
  tableHeight={tableHeight}
  onDetailsSelectionChange={setDetailsSelection}
/>
```

Replace the current right-side Details `<section>` with:

```tsx
<DetailsPane selection={detailsSelection} />
```

- [ ] **Step 5: Update App tests for empty Details**

In `node-shell/apps/desktop/renderer-src/src/App.test.tsx`, update the `AnalysisTabs` mock:

```tsx
vi.mock('./components/AnalysisTabs', () => ({
  AnalysisTabs: ({
    onDetailsSelectionChange,
    tableHeight,
  }: {
    onDetailsSelectionChange(selection: unknown): void;
    tableHeight: number;
  }) => (
    <button
      data-testid="analysis-tabs"
      data-height={tableHeight}
      onClick={() => onDetailsSelectionChange({
        kind: 'package',
        row: {
          id: 'base',
          fullPath: '../../../Engine/Config/Base.ini',
          fileName: 'Base.ini',
          type: 'INI',
          size: 1300,
          compressedSize: 900,
          physicalOrder: 1,
          source: {},
        },
      })}
    >
      Analysis tabs
    </button>
  ),
}));
```

Change the shell test assertion from:

```ts
expect(screen.getByText('Selection-specific region')).toBeInTheDocument();
```

to:

```ts
expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
expect(screen.queryByText('Selection-specific region')).not.toBeInTheDocument();
expect(screen.queryByText('Selected resource')).not.toBeInTheDocument();
```

Add this test:

```tsx
test('shows Details title only until a result row is selected', () => {
  const { container } = render(<App />);

  const details = container.querySelector('.details-region');
  expect(details?.textContent).toBe('Details');

  fireEvent.click(screen.getByTestId('analysis-tabs'));

  expect(screen.getByText('../../../Engine/Config/Base.ini')).toBeInTheDocument();
});
```

- [ ] **Step 6: Replace Details styles**

In `node-shell/apps/desktop/renderer-src/src/styles.css`, remove `.detail-card`, `.details-footer`, and `.container-kind-pill` rules. Add:

```css
.details-title-only {
  min-height: auto;
  padding-bottom: 18px;
}

.detail-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px 16px;
  overflow: auto;
}

.detail-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  background: var(--upi-panel-soft);
  border: 1px solid var(--upi-line-soft);
  border-radius: 6px;
}

.detail-value.ant-typography {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--upi-text);
  font-size: 13px;
  font-weight: 700;
}
```

- [ ] **Step 7: Run Details and App tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/components/DetailsPane.test.tsx apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS for both files.

- [ ] **Step 8: Commit Task 5**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/components/DetailsPane.tsx node-shell/apps/desktop/renderer-src/src/components/DetailsPane.test.tsx node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Add UPI Final details pane"
```

Expected: commit succeeds and includes only the five files listed above.

## Task 6: Opened Containers Width And Dragging

**Files:**
- Create: `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.ts`
- Create: `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts`
- Modify: `node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/App.test.tsx`
- Modify: `node-shell/apps/desktop/renderer-src/src/styles.css`

- [ ] **Step 1: Write adaptive width helper tests**

Create `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import type { PackageTreeNode } from '../types/upi';
import { clampOpenedContainersWidth, estimateOpenedContainersWidth } from './openedContainersPane';

const deepTree: PackageTreeNode = {
  name: 'Windows',
  kind: 'directory',
  children: [
    {
      name: 'RATrunk',
      kind: 'directory',
      children: [
        {
          name: 'LocalBuilds',
          kind: 'directory',
          children: [
            {
              name: 'Game',
              kind: 'directory',
              children: [
                { name: 'pakchunk0-Windows.pak', path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\pakchunk0-Windows.pak', kind: 'pak' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('openedContainersPane', () => {
  test('estimates a wider initial pane for deep supported file trees', () => {
    expect(estimateOpenedContainersWidth(deepTree, 1440)).toBeGreaterThan(304);
  });

  test('clamps width so the center and Details panes remain usable', () => {
    expect(clampOpenedContainersWidth(120, 1440)).toBe(236);
    expect(clampOpenedContainersWidth(900, 1440)).toBe(576);
  });
});
```

- [ ] **Step 2: Run helper tests and confirm they fail**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts
```

Expected: FAIL because `openedContainersPane.ts` does not exist.

- [ ] **Step 3: Implement adaptive width helpers**

Create `node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.ts`:

```ts
import type { PackageTreeNode } from '../types/upi';

export const OPENED_CONTAINERS_DEFAULT_WIDTH = 304;
export const OPENED_CONTAINERS_MIN_WIDTH = 236;
export const OPENED_CONTAINERS_MAX_FRACTION = 0.4;
export const OPENED_CONTAINERS_MAX_WIDTH = 640;

type TreeMetrics = {
  deepestSupportedDepth: number;
  longestSupportedLabel: number;
};

function isSupportedFile(node: PackageTreeNode): boolean {
  return node.kind === 'pak' || node.kind === 'utoc' || node.kind === 'ucas';
}

function measureTree(node: PackageTreeNode | null, depth = 0, metrics: TreeMetrics = {
  deepestSupportedDepth: 0,
  longestSupportedLabel: 0,
}): TreeMetrics {
  if (!node) {
    return metrics;
  }

  if (isSupportedFile(node)) {
    metrics.deepestSupportedDepth = Math.max(metrics.deepestSupportedDepth, depth);
    metrics.longestSupportedLabel = Math.max(metrics.longestSupportedLabel, (node.name || node.path || '').length);
  }

  node.children?.forEach((child) => measureTree(child, depth + 1, metrics));
  return metrics;
}

export function clampOpenedContainersWidth(width: number, viewportWidth: number): number {
  const maxByViewport = Math.floor(viewportWidth * OPENED_CONTAINERS_MAX_FRACTION);
  const maxWidth = Math.min(OPENED_CONTAINERS_MAX_WIDTH, Math.max(OPENED_CONTAINERS_MIN_WIDTH, maxByViewport));
  return Math.min(Math.max(Math.round(width), OPENED_CONTAINERS_MIN_WIDTH), maxWidth);
}

export function estimateOpenedContainersWidth(tree: PackageTreeNode | null | undefined, viewportWidth: number): number {
  const metrics = measureTree(tree ?? null);
  const indentWidth = metrics.deepestSupportedDepth * 24;
  const labelWidth = Math.min(metrics.longestSupportedLabel * 7, 260);
  const desiredWidth = Math.max(OPENED_CONTAINERS_DEFAULT_WIDTH, 96 + indentWidth + labelWidth);
  return clampOpenedContainersWidth(desiredWidth, viewportWidth);
}
```

- [ ] **Step 4: Add filesystem tree title/depth tests**

In `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts`, add:

```ts
test('uses full file path as tree node title for supported files', () => {
  const data = toAntTreeData({
    name: 'Windows',
    kind: 'directory',
    children: [
      {
        name: 'pakchunk0-Windows.pak',
        path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\pakchunk0-Windows.pak',
        kind: 'pak',
      },
    ],
  });

  expect(data[0].children?.[0]).toMatchObject({
    title: expect.anything(),
    key: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\pakchunk0-Windows.pak',
  });
});
```

- [ ] **Step 5: Make filesystem tree nodes expose full titles**

Modify `toAntTreeNode` in `node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts` so supported file titles keep the readable name and full path in the DOM title:

```ts
const visibleTitle = node.name || node.path || node.relativePath || '';
const fullTitle = node.path || node.relativePath || visibleTitle;

return {
  key,
  title: (
    <span className="opened-container-tree-title" title={fullTitle}>
      {visibleTitle}
    </span>
  ),
  selectable: isSupportedFileNode(node),
  children: children?.length ? children : undefined,
};
```

If JSX is not allowed in `.ts`, rename the file to `packageTreeData.tsx`, update imports in `PackageTree.tsx` and tests, and keep the same exports.

- [ ] **Step 6: Integrate pane width and drag in App**

In `node-shell/apps/desktop/renderer-src/src/App.tsx`, import:

```tsx
import {
  estimateOpenedContainersWidth,
  clampOpenedContainersWidth,
  OPENED_CONTAINERS_DEFAULT_WIDTH,
} from './utils/openedContainersPane';
```

Inside `App`, add state and effects:

```tsx
const [openedPaneWidth, setOpenedPaneWidth] = useState(OPENED_CONTAINERS_DEFAULT_WIDTH);
const [isResizingOpenedPane, setIsResizingOpenedPane] = useState(false);

useEffect(() => {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 1280;
  setOpenedPaneWidth(estimateOpenedContainersWidth(scan?.tree, viewportWidth));
}, [scan?.tree]);

useEffect(() => {
  if (!isResizingOpenedPane) {
    return undefined;
  }

  const handlePointerMove = (event: PointerEvent) => {
    setOpenedPaneWidth(clampOpenedContainersWidth(event.clientX - 24, window.innerWidth || 1280));
  };

  const handlePointerUp = () => {
    setIsResizingOpenedPane(false);
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp, { once: true });

  return () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };
}, [isResizingOpenedPane]);
```

Change `.workspace-panels` render to:

```tsx
<div
  className="workspace-panels"
  style={{ gridTemplateColumns: `${openedPaneWidth}px minmax(0, 1fr) minmax(236px, 304px)` }}
>
```

Add the resizer immediately after the Opened containers section content:

```tsx
<div
  aria-label="Resize opened containers"
  className="opened-containers-resizer"
  role="separator"
  tabIndex={0}
  onPointerDown={(event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingOpenedPane(true);
  }}
/>
```

- [ ] **Step 7: Add App tests for resize and no persistence**

In `node-shell/apps/desktop/renderer-src/src/App.test.tsx`, add:

```tsx
test('uses an adaptive Opened containers width and resizes by dragging without local persistence', () => {
  const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');
  mockHarness.state = createMockState({
    scan: {
      root: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows',
      files: [{ path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\pakchunk0-Windows.pak', kind: 'pak' }],
      tree: {
        name: 'Windows',
        kind: 'directory',
        children: [
          {
            name: 'LocalBuilds',
            kind: 'directory',
            children: [
              {
                name: 'Game',
                kind: 'directory',
                children: [
                  { name: 'pakchunk0-Windows.pak', path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\pakchunk0-Windows.pak', kind: 'pak' },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  const { container } = render(<App />);
  const panels = container.querySelector('.workspace-panels') as HTMLElement;
  const resizer = screen.getByRole('separator', { name: 'Resize opened containers' });

  expect(panels.style.gridTemplateColumns).toMatch(/px minmax\(0, 1fr\)/);

  fireEvent.pointerDown(resizer, { clientX: 320, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 520 });
  fireEvent.pointerUp(window);

  expect(panels.style.gridTemplateColumns).toContain('496px');
  expect(setItemSpy).not.toHaveBeenCalled();

  setItemSpy.mockRestore();
});
```

- [ ] **Step 8: Add resizer CSS**

Add to `node-shell/apps/desktop/renderer-src/src/styles.css`:

```css
.opened-containers-pane {
  position: relative;
}

.opened-containers-resizer {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
}

.opened-containers-resizer::after {
  position: absolute;
  top: 0;
  left: 4px;
  width: 2px;
  height: 100%;
  background: transparent;
  content: "";
}

.opened-containers-resizer:hover::after,
.opened-containers-resizer:focus-visible::after {
  background: var(--upi-accent);
}

.opened-container-tree-title {
  display: inline-block;
  max-width: none;
  white-space: nowrap;
}
```

- [ ] **Step 9: Run pane and App tests**

Run:

```powershell
npm.cmd --prefix node-shell exec -- vitest run --config apps/desktop/vitest.config.ts apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts apps/desktop/renderer-src/src/components/packageTreeData.test.ts apps/desktop/renderer-src/src/App.test.tsx
```

Expected: PASS for all three files.

- [ ] **Step 10: Commit Task 6**

Run:

```powershell
git add node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.ts node-shell/apps/desktop/renderer-src/src/utils/openedContainersPane.test.ts node-shell/apps/desktop/renderer-src/src/components/packageTreeData.ts node-shell/apps/desktop/renderer-src/src/components/packageTreeData.test.ts node-shell/apps/desktop/renderer-src/src/components/PackageTree.tsx node-shell/apps/desktop/renderer-src/src/App.tsx node-shell/apps/desktop/renderer-src/src/App.test.tsx node-shell/apps/desktop/renderer-src/src/styles.css
git commit -m "Make opened containers pane adaptive and resizable"
```

Expected: commit succeeds and includes only the files listed above. If `packageTreeData.ts` was renamed to `.tsx`, stage the renamed path and the import updates instead of the old `.ts` path.

## Task 7: Electron GUI Smoke Test

**Files:**
- Create: `node-shell/apps/desktop/test/electron-gui-smoke.test.js`

- [ ] **Step 1: Add the GUI smoke test**

Create `node-shell/apps/desktop/test/electron-gui-smoke.test.js`:

```js
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const nodeShellRoot = path.resolve(__dirname, '../../..');
const electronPath = require('electron');
const mainPath = path.join(nodeShellRoot, 'apps', 'desktop', 'main.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function waitForPage(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const pages = await getJson(`http://127.0.0.1:${port}/json`);
      const page = pages.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
      if (page) {
        return page;
      }
    } catch {
      await delay(250);
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for Electron DevTools page');
}

async function cdpCall(socket, method, params = {}) {
  const id = cdpCall.nextId += 1;
  const payload = JSON.stringify({ id, method, params });
  socket.send(payload);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout for ${method}`)), 10000);
    const handleMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) {
        return;
      }

      clearTimeout(timeout);
      socket.removeEventListener('message', handleMessage);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    };
    socket.addEventListener('message', handleMessage);
  });
}
cdpCall.nextId = 0;

test('Electron renderer smoke through DevTools Protocol', async (t) => {
  const port = 9333;
  const child = spawn(electronPath, [`--remote-debugging-port=${port}`, mainPath], {
    cwd: nodeShellRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    child.kill();
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
  });

  const page = await waitForPage(port);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  t.after(() => socket.close());

  const exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.text);
    }
  });

  await cdpCall(socket, 'Runtime.enable');
  await cdpCall(socket, 'Page.enable');
  await delay(1000);

  const result = await cdpCall(socket, 'Runtime.evaluate', {
    expression: `(() => {
      const root = document.querySelector('#root');
      const bodyText = document.body.innerText;
      return {
        hasRootContent: Boolean(root && root.children.length > 0),
        hasOverview: bodyText.includes('Overview'),
        hasPackages: bodyText.includes('Packages'),
        hasIssues: bodyText.includes('Issues'),
        hasDetails: bodyText.includes('Details'),
        hasOpenedContainers: bodyText.includes('Opened containers'),
        hasPreloadApi: typeof window.upi === 'object',
      };
    })()`,
    returnByValue: true,
  });

  assert.deepEqual(result.result.value, {
    hasRootContent: true,
    hasOverview: true,
    hasPackages: true,
    hasIssues: true,
    hasDetails: true,
    hasOpenedContainers: true,
    hasPreloadApi: true,
  });
  assert.deepEqual(exceptions, []);
  assert.equal(stderr.some((line) => /runtime exception/i.test(line)), false);
});
```

- [ ] **Step 2: Build renderer and run smoke**

Run:

```powershell
npm.cmd --prefix node-shell run build:renderer
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

Expected: renderer build exits 0 and the smoke test reports one passing test.

- [ ] **Step 3: Commit Task 7**

Run:

```powershell
git add node-shell/apps/desktop/test/electron-gui-smoke.test.js
git commit -m "Add Electron GUI smoke test"
```

Expected: commit succeeds and includes only the smoke test file.

## Task 8: Full Verification And Cleanup

**Files:**
- Modify only files that fail tests or visual smoke because of the earlier tasks.

- [ ] **Step 1: Run all renderer checks**

Run:

```powershell
npm.cmd --prefix node-shell run test:renderer
```

Expected: typecheck passes, Vitest passes, and renderer build passes.

- [ ] **Step 2: Run all node-shell checks**

Run:

```powershell
npm.cmd --prefix node-shell test
```

Expected: node tests, renderer tests, and renderer build pass.

- [ ] **Step 3: Run fresh Electron GUI smoke**

Run:

```powershell
npm.cmd --prefix node-shell exec -- node --test apps/desktop/test/electron-gui-smoke.test.js
```

Expected: smoke test passes, renderer exceptions list is empty, `#root` has content, visible text includes `Overview`, `Packages`, `Issues`, `Opened containers`, and `Details`, and `window.upi` is available.

- [ ] **Step 4: Inspect final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` shows only intended task files as modified or untracked, plus any pre-existing unrelated workspace changes that must remain unstaged.

- [ ] **Step 5: Commit final fixes when Step 4 shows task-owned files**

If Step 4 shows task-owned files after test fixes, commit them:

```powershell
git add <task-owned-files>
git commit -m "Polish UPI Final UI contract"
```

Expected: commit succeeds and excludes pre-existing unrelated changes such as `node-shell/package.json`, `node-shell/package-lock.json`, or `node-shell/Engine/` unless those files were intentionally changed during execution.
