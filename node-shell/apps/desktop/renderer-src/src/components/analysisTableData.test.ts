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
