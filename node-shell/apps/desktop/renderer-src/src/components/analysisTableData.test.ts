import { describe, expect, test } from 'vitest';
import { buildColumnKeys, buildColumns, buildDataSource, rowKey } from './analysisTableData';

describe('analysisTableData', () => {
  test('builds ordered union columns from row object keys', () => {
    expect(buildColumnKeys([
      { name: 'A', offset: 0 },
      { size: 42, name: 'B' },
    ])).toEqual(['name', 'offset', 'size']);
  });

  test('creates stable row keys from path-like fields before index fallback', () => {
    expect(rowKey({ path: 'C:\\Paks\\A.pak' }, 7)).toBe('C:\\Paks\\A.pak');
    expect(rowKey({ relativePath: 'Loose/A.pak' }, 6)).toBe('Loose/A.pak');
    expect(rowKey({ name: 'chunk-1' }, 2)).toBe('chunk-1');
    expect(rowKey({ id: 123 }, 4)).toBe('123');
    expect(rowKey({ value: 12 }, 3)).toBe('row-3');
  });

  test('renders column values with shared formatter behavior', () => {
    const columns = buildColumns([
      {
        metadata: { path: 'C:\\Paks\\A.pak', size: 12n },
        nullable: null,
      },
    ]);

    const metadataColumn = columns.find((column) => column.key === 'metadata');
    const nullableColumn = columns.find((column) => column.key === 'nullable');
    const metadataRender = metadataColumn && 'render' in metadataColumn ? metadataColumn.render : undefined;
    const nullableRender = nullableColumn && 'render' in nullableColumn ? nullableColumn.render : undefined;

    expect(nullableRender?.(null, {}, 0)).toBe('null');
    expect(metadataRender?.({ path: 'C:\\Paks\\A.pak', size: 12n }, {}, 0)).toBe(
      '{"path":"C:\\\\Paks\\\\A.pak","size":"12"}',
    );
  });

  test('builds distinct data source keys for duplicate path rows', () => {
    expect(buildDataSource([
      { path: 'C:\\Paks\\A.pak', offset: 0 },
      { path: 'C:\\Paks\\A.pak', offset: 1 },
    ]).map((row) => row.__rowKey)).toEqual(['C:\\Paks\\A.pak', 'C:\\Paks\\A.pak::1']);
  });

  test('builds distinct data source keys for duplicate name rows', () => {
    expect(buildDataSource([
      { name: 'chunk-1', offset: 0 },
      { name: 'chunk-1', offset: 1 },
    ]).map((row) => row.__rowKey)).toEqual(['chunk-1', 'chunk-1::1']);
  });

  test('builds distinct data source keys for duplicate id rows', () => {
    expect(buildDataSource([
      { id: 42, offset: 0 },
      { id: 42, offset: 1 },
    ]).map((row) => row.__rowKey)).toEqual(['42', '42::1']);
  });
});
