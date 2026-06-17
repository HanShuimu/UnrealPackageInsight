import type { ColumnsType } from 'antd/es/table';

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

function formatLabel(key: string): string {
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!label) {
    return key;
  }

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
  return rows.map((row, index) => ({
    ...normalizeRow(row),
    [ROW_KEY_FIELD]: rowKey(row, index),
  }));
}
