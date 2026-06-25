import { Empty, Table } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useMemo } from 'react';
import type { PackageRow } from '../utils/analysisViewModel';
import {
  PACKAGE_TABLE_COLUMNS,
  sortPackageRows,
  type PackageTableColumnKey,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';

type PackageTableProps = {
  rows: PackageRow[];
  height: number;
  sortState: PackageTableSortState;
  onSelectPackage(row: PackageRow): void;
  onSortChange(sortState: PackageTableSortState): void;
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return '';
  }

  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${sign}${value} ${BYTE_UNITS[unitIndex]}`;
  }

  return `${sign}${value.toFixed(2)} ${BYTE_UNITS[unitIndex]}`;
}

const PACKAGE_COLUMN_KEYS = new Set<PackageTableColumnKey>(
  PACKAGE_TABLE_COLUMNS.map((column) => column.key),
);

function isPackageTableColumnKey(value: unknown): value is PackageTableColumnKey {
  return typeof value === 'string' && PACKAGE_COLUMN_KEYS.has(value as PackageTableColumnKey);
}

export function PackageTable({
  rows,
  height,
  sortState,
  onSelectPackage,
  onSortChange,
}: PackageTableProps) {
  const columns = useMemo<ColumnsType<PackageRow>>(() => PACKAGE_TABLE_COLUMNS.map((column) => ({
    dataIndex: column.dataIndex,
    key: column.key,
    title: column.title,
    fixed: column.fixed,
    ellipsis: column.key === 'fullPath' ? false : undefined,
    width: column.width,
    className: column.className,
    sorter: column.compare
      ? (left, right, sortOrder) => column.compare?.(left, right, sortOrder) ?? 0
      : undefined,
    sortOrder: sortState?.columnKey === column.key ? sortState.order : undefined,
    render: (value, row) => {
      if (column.key === 'fullPath') {
        return (
          <span className="package-path-cell" title={row.fullPath}>
            {row.fullPath}
          </span>
        );
      }
      if (column.key === 'size') {
        return formatBytes(value as PackageRow['size']);
      }
      if (column.key === 'compressedSize') {
        return formatBytes(value as PackageRow['compressedSize']);
      }
      if (column.key === 'physicalOrder') {
        return (value as PackageRow['physicalOrder']) ?? '';
      }
      return value;
    },
  })), [sortState]);
  const dataSource = useMemo(() => sortPackageRows(rows, sortState), [rows, sortState]);
  const handleChange = useCallback<NonNullable<TableProps<PackageRow>['onChange']>>((
    _pagination,
    _filters,
    sorter,
  ) => {
    const activeSorter = Array.isArray(sorter) ? sorter.find((candidate) => candidate.order) : sorter;
    const columnKey = activeSorter?.columnKey;
    const order = activeSorter?.order;

    if (isPackageTableColumnKey(columnKey) && (order === 'ascend' || order === 'descend')) {
      onSortChange({ columnKey, order });
      return;
    }

    onSortChange(null);
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
