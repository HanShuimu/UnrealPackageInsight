const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('buildPackageRows avoids duplicate id suffix collisions with real package paths', () => {
  const rows = buildPackageRows({
    packages: [
      { packagePath: '../../../Game/A.uasset' },
      { packagePath: '../../../Game/A.uasset' },
      { packagePath: '../../../Game/A.uasset#2' },
      { packagePath: '../../../Game/B.uasset' },
    ],
  });

  assert.deepEqual(rows.map((row) => row.fullPath), [
    '../../../Game/A.uasset',
    '../../../Game/A.uasset',
    '../../../Game/A.uasset#2',
    '../../../Game/B.uasset',
  ]);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(rows.find((row) => row.fullPath === '../../../Game/B.uasset').id, '../../../Game/B.uasset');
});

test('buildPackageRows treats unsafe bigint numeric values as unavailable', () => {
  const rows = buildPackageRows({
    packages: [
      {
        packagePath: '../../../Game/Safe.uasset',
        size: BigInt(Number.MAX_SAFE_INTEGER),
        compressedSize: 12n,
        physicalOrder: 1n,
      },
      {
        packagePath: '../../../Game/Unsafe.uasset',
        size: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
        compressedSize: BigInt(Number.MAX_SAFE_INTEGER) + 3n,
        physicalOrder: BigInt(Number.MAX_SAFE_INTEGER) + 4n,
      },
    ],
  });

  const safeRow = rows.find((row) => row.fullPath === '../../../Game/Safe.uasset');
  const unsafeRow = rows.find((row) => row.fullPath === '../../../Game/Unsafe.uasset');

  assert.equal(safeRow.size, Number.MAX_SAFE_INTEGER);
  assert.equal(safeRow.compressedSize, 12);
  assert.equal(safeRow.physicalOrder, 1);
  assert.equal(unsafeRow.size, undefined);
  assert.equal(unsafeRow.compressedSize, undefined);
  assert.equal(unsafeRow.physicalOrder, undefined);
  assert.equal(
    serializePackagesCsv([unsafeRow]),
    '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/Unsafe.uasset,,,\r\n',
  );
});

test('buildPackageRows treats unsafe and non-integer numeric strings as unavailable', () => {
  const rows = buildPackageRows({
    packages: [
      {
        packagePath: '../../../Game/UnsafeString.uasset',
        size: '9007199254740993',
        compressedSize: '9007199254740992',
        physicalOrder: '12.5',
      },
    ],
  });

  assert.equal(rows[0].size, undefined);
  assert.equal(rows[0].compressedSize, undefined);
  assert.equal(rows[0].physicalOrder, undefined);
  assert.equal(
    serializePackagesCsv(rows),
    '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/UnsafeString.uasset,,,\r\n',
  );
});

test('buildPackageRows treats unsafe and non-integer numeric numbers as unavailable', () => {
  const rows = buildPackageRows({
    packages: [
      {
        packagePath: '../../../Game/UnsafeNumber.uasset',
        size: Number.MAX_SAFE_INTEGER + 1,
        compressedSize: 42.5,
        physicalOrder: Number.MIN_SAFE_INTEGER - 1,
      },
    ],
  });

  assert.equal(rows[0].size, undefined);
  assert.equal(rows[0].compressedSize, undefined);
  assert.equal(rows[0].physicalOrder, undefined);
  assert.equal(
    serializePackagesCsv(rows),
    '\ufeffFull Path,Size,Compressed,Order\r\n../../../Game/UnsafeNumber.uasset,,,\r\n',
  );
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

test('sortPackageRows keeps blank numeric values last for descending sorts', () => {
  const rows = [
    { id: 'missing', fullPath: '/Game/Missing.uasset', fileName: 'Missing.uasset', source: {} },
    { id: 'small', fullPath: '/Game/Small.uasset', fileName: 'Small.uasset', size: 5, source: {} },
    { id: 'large', fullPath: '/Game/Large.uasset', fileName: 'Large.uasset', size: 20, source: {} },
  ];

  assert.deepEqual(
    sortPackageRows(rows, { columnKey: 'size', order: 'descend' }).map((row) => row.id),
    ['large', 'small', 'missing'],
  );
});

test('numeric column compare accepts sort order and keeps blank values last', () => {
  const sizeColumn = PACKAGE_TABLE_COLUMNS.find((column) => column.key === 'size');
  const rows = [
    { id: 'missing', fullPath: '/Game/Missing.uasset', fileName: 'Missing.uasset', source: {} },
    { id: 'small', fullPath: '/Game/Small.uasset', fileName: 'Small.uasset', size: 5, source: {} },
    { id: 'large', fullPath: '/Game/Large.uasset', fileName: 'Large.uasset', size: 20, source: {} },
  ];

  assert.equal(typeof sizeColumn.compare, 'function');
  assert.deepEqual([...rows].sort(sizeColumn.compare).map((row) => row.id), ['small', 'large', 'missing']);
  assert.deepEqual(
    [...rows].sort((left, right) => sizeColumn.compare(left, right, null)).map((row) => row.id),
    ['small', 'large', 'missing'],
  );
  assert.deepEqual(
    [...rows].sort((left, right) => sizeColumn.compare(left, right, 'descend')).map((row) => row.id),
    ['large', 'small', 'missing'],
  );
});

test('TypeScript declarations allow Ant Design null sort order for column compare', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'packages-table-export-types-'));
  try {
    const modulePath = path.resolve(__dirname, '../src/packages-table-export.js');
    const relativeModulePath = path.relative(tempDir, modulePath).replace(/\\/g, '/');
    const moduleSpecifier = relativeModulePath.startsWith('.') ? relativeModulePath : `./${relativeModulePath}`;
    const probePath = path.join(tempDir, 'probe.ts');
    writeFileSync(probePath, `
import type { PackageRow, PackageTableColumn } from '${moduleSpecifier}';

type AntSortOrder = 'ascend' | 'descend' | null;
type AntCompareFn<T> = (left: T, right: T, sortOrder: AntSortOrder) => number;

declare const column: PackageTableColumn;
if (column.compare) {
  const sorter: AntCompareFn<PackageRow> = column.compare;
  void sorter;
}
`);

    const result = spawnSync(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '--strict',
      '--module',
      'CommonJS',
      '--moduleResolution',
      'node',
      '--target',
      'ES2022',
      '--noEmit',
      probePath,
    ], { cwd: tempDir, encoding: 'utf8' });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test('comparators remain available for renderer detail and tree code', () => {
  const rows = [
    { id: 'b', fullPath: '/Game/Beta.uasset', fileName: 'Beta.uasset', physicalOrder: 8, source: {} },
    { id: 'a', fullPath: '/Game/Alpha.uasset', fileName: 'Alpha.uasset', physicalOrder: 1, source: {} },
  ];

  assert.deepEqual([...rows].sort(comparePackageFileName).map((row) => row.id), ['a', 'b']);
  assert.deepEqual([...rows].sort(comparePackageOrder).map((row) => row.id), ['a', 'b']);
});

test('text comparators use an explicit deterministic locale', () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  const locales = [];
  String.prototype.localeCompare = function patchedLocaleCompare(that, locale, options) {
    locales.push(locale);
    return originalLocaleCompare.call(this, that, 'en', options);
  };

  try {
    comparePackageFileName(
      { id: 'left', fullPath: '/Game/File2.uasset', fileName: 'File2.uasset', source: {} },
      { id: 'right', fullPath: '/Game/File10.uasset', fileName: 'File10.uasset', source: {} },
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }

  assert.ok(locales.length > 0);
  assert.deepEqual([...new Set(locales)], ['en']);
});

test('serializePackagesCsv emits UTF-8 BOM, headers, CRLF, blanks, and standard CSV escaping', () => {
  const rows = [
    {
      id: 'quoted',
      fullPath: '../../../Game/Foo, "Bar".uasset',
      fileName: 'Foo, "Bar".uasset',
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
      + '"../../../Game/Foo, ""Bar"".uasset",2048,,2\r\n'
      + '"../../../Game/Line\r\nBreak.uasset",10,5,1\r\n',
  );
});
