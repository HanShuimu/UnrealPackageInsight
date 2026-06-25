export type PackageRow = {
  id: string;
  fullPath: string;
  fileName: string;
  type?: string;
  size?: number;
  compressedSize?: number;
  physicalOrder?: number;
  source: Record<string, unknown>;
};

export type PackageTableColumnKey = 'fullPath' | 'size' | 'compressedSize' | 'physicalOrder';
export type PackageTableSortOrder = 'ascend' | 'descend';
export type PackageTableSortState = {
  columnKey: PackageTableColumnKey;
  order: PackageTableSortOrder;
} | null;

export type PackageTableColumn = {
  key: PackageTableColumnKey;
  dataIndex: keyof PackageRow;
  title: string;
  width: number;
  fixed?: 'left';
  className?: string;
  compare?: (left: PackageRow, right: PackageRow) => number;
  exportValue(row: PackageRow): string | number | undefined;
};

export const PACKAGE_TABLE_COLUMNS: readonly PackageTableColumn[];
export const PACKAGE_TABLE_DEFAULT_SORT: Exclude<PackageTableSortState, null>;
export function buildPackageRows(result: { packages?: unknown[] } | null | undefined): PackageRow[];
export function comparePackageFileName(left: PackageRow, right: PackageRow): number;
export function comparePackageOrder(left: PackageRow, right: PackageRow): number;
export function serializePackagesCsv(
  rows: PackageRow[],
  columns?: readonly PackageTableColumn[],
): string;
export function sortPackageRows(
  rows: PackageRow[],
  sortState?: PackageTableSortState,
): PackageRow[];
