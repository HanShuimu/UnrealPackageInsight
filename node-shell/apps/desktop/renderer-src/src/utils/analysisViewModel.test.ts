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
  type AnalysisTabModel,
  type PackageRow,
} from './analysisViewModel';

const expectedTabIds = ['overview', 'packages', 'issues'];

const analysisTabContractIds: AnalysisTabModel['id'][] = ['overview', 'packages', 'issues'];
void analysisTabContractIds;

// @ts-expect-error raw is not part of the public view-model tab contract.
const rawTabIsNotAnalysisTabModel: AnalysisTabModel = { id: 'raw', label: 'Raw', kind: 'raw' };
void rawTabIsNotAnalysisTabModel;

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

function tabIds(result: AnalysisResult | null) {
  return buildAnalysisViewModel(result).tabs.map((tab) => tab.id);
}

describe('analysis view-model tabs', () => {
  test.each([
    ['null result', null],
    ['issue-only result', { issues: [{ severity: 'error', message: 'Broken' }] }],
    ['Pak-like result', { packages: [], compressedBlocks: [], issues: [] }],
    ['IoStore-like result', { chunks: [], packages: [], compressedBlocks: [], partitions: [], issues: [] }],
    ['unknown backend-field result', { customBackendField: [{ id: 1 }] }],
  ] satisfies Array<[string, AnalysisResult | null]>)('exposes only approved tabs for %s', (_name, result) => {
    expect(ANALYSIS_TABS.map((tab) => tab.id)).toEqual(expectedTabIds);
    expect(tabIds(result)).toEqual(expectedTabIds);
  });
});

describe('buildOverviewCards', () => {
  test('returns only design-approved cards derived from real data', () => {
    expect(buildOverviewCards(pakResult)).toEqual([
      { id: 'packages', label: 'Packages', value: '2' },
      { id: 'totalSize', label: 'Total Size', value: '4.20 KB' },
      { id: 'compressedSize', label: 'Compressed Size', value: '2.05 KB' },
      { id: 'issues', label: 'Issues', value: '1' },
    ]);
  });

  test('omits cards with no real source data', () => {
    expect(buildOverviewCards({ overview: { unusedField: 'ignore me' }, arbitraryBackendField: 12 }))
      .toEqual([]);
  });
});

describe('buildPackageRows', () => {
  test('normalizes backend package entries and sorts by file basename', () => {
    expect(buildPackageRows(pakResult)).toEqual([
      {
        id: '../../../Engine/Config/Base.ini',
        fullPath: '../../../Engine/Config/Base.ini',
        fileName: 'Base.ini',
        type: 'ini',
        size: 1300,
        compressedSize: 900,
        physicalOrder: 1,
        source: {
          packagePath: '../../../Engine/Config/Base.ini',
          size: 1300,
          compressedSize: 900,
          order: 1,
        },
      },
      {
        id: '../../../Game/Zeta/Beta.uasset',
        fullPath: '../../../Game/Zeta/Beta.uasset',
        fileName: 'Beta.uasset',
        type: 'uasset',
        size: 3000,
        compressedSize: 1200,
        physicalOrder: 8,
        source: {
          packagePath: '../../../Game/Zeta/Beta.uasset',
          size: 3000,
          compressedSize: 1200,
          order: 8,
        },
      },
    ]);
  });

  test('supports alternate path and numeric field names with duplicate-safe IDs', () => {
    expect(buildPackageRows({
      packages: [
        { fullPath: 'C:/Game/Foo.uasset', diskSize: '10', compressedSize: '5', physicalOrder: '3' },
        { relativePath: 'C:/Game/Foo.uasset', size: '12', order: '4' },
        { name: 'C:/Game/Bar.uasset', size: '1' },
        { size: 99 },
      ],
    })).toEqual([
      expect.objectContaining({ id: 'C:/Game/Bar.uasset', fullPath: 'C:/Game/Bar.uasset', fileName: 'Bar.uasset', size: 1 }),
      expect.objectContaining({ id: 'C:/Game/Foo.uasset', fullPath: 'C:/Game/Foo.uasset', fileName: 'Foo.uasset', size: 10, compressedSize: 5, physicalOrder: 3 }),
      expect.objectContaining({ id: 'C:/Game/Foo.uasset#2', fullPath: 'C:/Game/Foo.uasset', fileName: 'Foo.uasset', size: 12, physicalOrder: 4 }),
    ]);
  });

  test('normalizes native decoded bigint size fields for Pak and IoStore package rows', () => {
    expect(buildPackageRows({
      packages: [
        {
          packagePath: '../../../Engine/Config/Base.ini',
          size: 1300n,
          compressedSize: 900n,
          order: 1,
        },
        {
          package_path: '../../../Game/Zeta/Beta.uasset',
          disk_size: 3000n,
          compressed_size: 1200n,
          physical_order: 8,
        },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Engine/Config/Base.ini',
        fullPath: '../../../Engine/Config/Base.ini',
        size: 1300,
        compressedSize: 900,
        physicalOrder: 1,
      }),
      expect.objectContaining({
        id: '../../../Game/Zeta/Beta.uasset',
        fullPath: '../../../Game/Zeta/Beta.uasset',
        size: 3000,
        compressedSize: 1200,
        physicalOrder: 8,
      }),
    ]);
  });

  test('falls back to the next path field when packagePath is blank', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '', path: '../../../Game/Fallback.uasset' },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/Fallback.uasset',
        fullPath: '../../../Game/Fallback.uasset',
        fileName: 'Fallback.uasset',
      }),
    ]);
  });

  test('falls back to physicalOrder when order is blank', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '../../../Game/Fallback.uasset', order: '', physicalOrder: 4 },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/Fallback.uasset',
        physicalOrder: 4,
      }),
    ]);
  });

  test('preserves zero physical order values from order', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '../../../Game/Zero.uasset', order: 0, physicalOrder: 4 },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/Zero.uasset',
        physicalOrder: 0,
      }),
    ]);
  });

  test('falls back to the next path field when packagePath is whitespace', () => {
    expect(buildPackageRows({
      packages: [
        { packagePath: '   ', path: '../../../Game/Whitespace.uasset' },
      ],
    })).toEqual([
      expect.objectContaining({
        id: '../../../Game/Whitespace.uasset',
        fullPath: '../../../Game/Whitespace.uasset',
        fileName: 'Whitespace.uasset',
      }),
    ]);
  });

  test('keeps generated package IDs distinct when package paths include duplicate suffixes', () => {
    const rows = buildPackageRows({
      packages: [
        { packagePath: '../../../Game/A.uasset' },
        { packagePath: '../../../Game/A.uasset' },
        { packagePath: '../../../Game/A.uasset#2' },
      ],
    });

    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });
});

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

describe('package row comparators', () => {
  const rows: PackageRow[] = [
    { id: 'b', fullPath: '/Game/Beta.uasset', fileName: 'Beta.uasset', physicalOrder: 8, source: {} },
    { id: 'a', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOrder: 1, source: {} },
    { id: 'c', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOrder: undefined, source: {} },
  ];

  test('comparePackageFileName sorts by basename with stable path tie-breaks', () => {
    expect([...rows].sort(comparePackageFileName).map((row) => row.id)).toEqual(['a', 'c', 'b']);
  });

  test('comparePackageOrder sorts known physical order before unknown order', () => {
    expect([...rows].sort(comparePackageOrder).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildPackageTree', () => {
  test('builds a package-content tree while preserving relative prefix keys', () => {
    expect(buildPackageTree(buildPackageRows(pakResult))).toEqual([
      {
        key: '../../../Engine',
        title: 'Engine',
        selectable: false,
        children: [
          {
            key: '../../../Engine/Config',
            title: 'Config',
            selectable: false,
            children: [
              {
                key: '../../../Engine/Config/Base.ini',
                title: 'Base.ini',
                packageRowId: '../../../Engine/Config/Base.ini',
                selectable: true,
              },
            ],
          },
        ],
      },
      {
        key: '../../../Game',
        title: 'Game',
        selectable: false,
        children: [
          {
            key: '../../../Game/Zeta',
            title: 'Zeta',
            selectable: false,
            children: [
              {
                key: '../../../Game/Zeta/Beta.uasset',
                title: 'Beta.uasset',
                packageRowId: '../../../Game/Zeta/Beta.uasset',
                selectable: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  test('sorts tree siblings by hierarchy instead of package filename order', () => {
    const rows = buildPackageRows({
      packages: [
        { packagePath: '../../../Game/Zeta/A.uasset' },
        { packagePath: '../../../Engine/Config/Z.ini' },
      ],
    });

    expect(rows.map((row) => row.fileName)).toEqual(['A.uasset', 'Z.ini']);
    expect(buildPackageTree(rows).map((node) => node.title)).toEqual(['Engine', 'Game']);
  });

  test('creates distinct leaf keys for duplicate package paths without changing display titles', () => {
    const tree = buildPackageTree([
      {
        id: '../../../Game/Foo.uasset',
        fullPath: '../../../Game/Foo.uasset',
        fileName: 'Foo.uasset',
        source: {},
      },
      {
        id: '../../../Game/Foo.uasset#2',
        fullPath: '../../../Game/Foo.uasset',
        fileName: 'Foo.uasset',
        source: {},
      },
    ]);
    const leaves = tree[0]?.children ?? [];

    expect(leaves).toEqual([
      {
        key: '../../../Game/Foo.uasset::../../../Game/Foo.uasset',
        title: 'Foo.uasset',
        packageRowId: '../../../Game/Foo.uasset',
        selectable: true,
      },
      {
        key: '../../../Game/Foo.uasset::../../../Game/Foo.uasset#2',
        title: 'Foo.uasset',
        packageRowId: '../../../Game/Foo.uasset#2',
        selectable: true,
      },
    ]);
    expect(new Set(leaves.map((leaf) => leaf.key)).size).toBe(2);
  });
});

describe('buildIssueRows', () => {
  test('normalizes issues to design-approved fields and keeps the source', () => {
    const issue = { severity: 'warning', code: 'W001', message: 'Missing optional summary', ignored: true };

    expect(buildIssueRows({ issues: [issue] })).toEqual([
      {
        id: 'issue-1',
        severity: 'warning',
        code: 'W001',
        message: 'Missing optional summary',
        source: issue,
      },
    ]);
  });
});
