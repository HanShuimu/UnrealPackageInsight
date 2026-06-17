import type { ColumnsType } from 'antd/es/table';
import { formatLabel, formatValue } from '../utils/format';

export type TableRecord = Record<string, unknown>;

const ROW_KEY_FIELDS = ['path', 'relativePath', 'name', 'id'] as const;
const ROW_KEY_FIELD = '__rowKey';

export function normalizeRow(row: unknown): TableRecord {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return row as TableRecord;
  }

  return { value: row };
}

export function buildColumnKeys(rows: unknown[]): string[] {
  const keys = new Set<string>();

  rows.forEach((row) => {
    Object.keys(normalizeRow(row)).forEach((key) => {
      if (key !== ROW_KEY_FIELD) {
        keys.add(key);
      }
    });
  });

  return Array.from(keys);
}

export function rowKey(row: unknown, index: number): string {
  const record = normalizeRow(row);

  for (const field of ROW_KEY_FIELDS) {
    const value = record[field];
    if (value !== null && value !== undefined && String(value) !== '') {
      return String(value);
    }
  }

  return `row-${index}`;
}

export function buildColumns(rows: unknown[]): ColumnsType<TableRecord> {
  return buildColumnKeys(rows).map((key) => ({
    dataIndex: key,
    ellipsis: true,
    key,
    render: (value: unknown) => formatValue(value),
    title: formatLabel(key),
  }));
}

export function buildDataSource(rows: unknown[]): TableRecord[] {
  const seenKeys = new Set<string>();

  return rows.map((row, index) => {
    const baseKey = rowKey(row, index);
    const uniqueKey = seenKeys.has(baseKey) ? `${baseKey}::${index}` : baseKey;
    seenKeys.add(baseKey);

    return {
      ...normalizeRow(row),
      [ROW_KEY_FIELD]: uniqueKey,
    };
  });
}
