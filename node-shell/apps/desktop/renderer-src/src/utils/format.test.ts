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
