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
