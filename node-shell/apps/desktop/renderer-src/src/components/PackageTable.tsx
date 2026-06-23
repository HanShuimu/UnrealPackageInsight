import { Empty, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useMemo } from 'react';
import { comparePackageFileName, type PackageRow } from '../utils/analysisViewModel';

type PackageTableProps = {
  rows: PackageRow[];
  height: number;
  onSelectPackage(row: PackageRow): void;
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

function compareNumericField(field: 'size' | 'compressedSize' | 'physicalOrder') {
  return (left: PackageRow, right: PackageRow): number => {
    const leftValue = left[field];
    const rightValue = right[field];
    const leftHasValue = leftValue !== undefined && Number.isFinite(leftValue);
    const rightHasValue = rightValue !== undefined && Number.isFinite(rightValue);

    if (leftHasValue && rightHasValue && leftValue !== rightValue) {
      return leftValue - rightValue;
    }

    if (leftHasValue !== rightHasValue) {
      return leftHasValue ? -1 : 1;
    }

    return comparePackageFileName(left, right);
  };
}

const columns: ColumnsType<PackageRow> = [
  {
    dataIndex: 'fullPath',
    key: 'fullPath',
    title: 'Full Path',
    fixed: 'left',
    ellipsis: false,
    width: 520,
    className: 'package-path-column',
    render: (fullPath: PackageRow['fullPath']) => (
      <span className="package-path-cell" title={fullPath}>
        {fullPath}
      </span>
    ),
  },
  {
    dataIndex: 'size',
    key: 'size',
    title: 'Size',
    width: 120,
    sorter: compareNumericField('size'),
    render: (size: PackageRow['size']) => formatBytes(size),
  },
  {
    dataIndex: 'compressedSize',
    key: 'compressedSize',
    title: 'Compressed',
    width: 140,
    sorter: compareNumericField('compressedSize'),
    render: (compressedSize: PackageRow['compressedSize']) => formatBytes(compressedSize),
  },
  {
    dataIndex: 'physicalOrder',
    key: 'physicalOrder',
    title: 'Order',
    width: 100,
    sorter: compareNumericField('physicalOrder'),
    render: (physicalOrder: PackageRow['physicalOrder']) => physicalOrder ?? '',
  },
];

export function PackageTable({ rows, height, onSelectPackage }: PackageTableProps) {
  const dataSource = useMemo(() => [...rows].sort(comparePackageFileName), [rows]);
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
      onRow={handleRow}
    />
  );
}
