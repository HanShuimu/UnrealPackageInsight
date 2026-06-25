import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PackageRow } from '../utils/analysisViewModel';
import {
  PACKAGE_TABLE_COLUMNS,
  PACKAGE_TABLE_DEFAULT_SORT,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
import { PackageTable } from './PackageTable';

type MockColumn = {
  title?: React.ReactNode;
  dataIndex?: string;
  key?: string;
  fixed?: string;
  ellipsis?: boolean;
  width?: number;
  className?: string;
  sorter?: (left: PackageRow, right: PackageRow, sortOrder?: 'ascend' | 'descend' | null) => number;
  sortOrder?: 'ascend' | 'descend' | null;
  render?: (value: unknown, row: PackageRow) => React.ReactNode;
};

type MockTableProps = {
  bordered?: boolean;
  columns?: MockColumn[];
  dataSource?: PackageRow[];
  pagination?: false;
  rowKey?: string;
  scroll?: { x?: number; y?: number };
  size?: string;
  tableLayout?: string;
  virtual?: boolean;
  onRow?: (row: PackageRow) => { onClick?: () => void };
  onChange?: (
    pagination: unknown,
    filters: unknown,
    sorter: { columnKey?: React.Key; order?: 'ascend' | 'descend' | null } | Array<unknown>,
  ) => void;
};

const tableHarness = vi.hoisted(() => ({
  props: [] as MockTableProps[],
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Table: (props: MockTableProps) => {
      tableHarness.props.push(props);
      const pathColumn = props.columns?.[0];

      return (
        <div
          data-testid="mock-table"
          data-bordered={String(props.bordered)}
          data-pagination={String(props.pagination)}
          data-row-key={props.rowKey}
          data-scroll-x={String(props.scroll?.x)}
          data-scroll-y={String(props.scroll?.y)}
          data-size={props.size}
          data-table-layout={props.tableLayout}
          data-virtual={String(props.virtual)}
        >
          {props.dataSource?.map((row) => {
            const rowEvents = props.onRow?.(row) ?? {};

            return (
              <button key={row.id} type="button" data-testid={`row-${row.id}`} onClick={rowEvents.onClick}>
                {pathColumn?.render?.(row.fullPath, row)}
              </button>
            );
          })}
        </div>
      );
    },
  };
});

const rows: PackageRow[] = [
  {
    id: 'beta',
    fullPath: '../../../Game/Zeta/Beta.uasset',
    fileName: 'Beta.uasset',
    type: 'uasset',
    size: 3000,
    compressedSize: 1200,
    physicalOrder: 8,
    source: {},
  },
  {
    id: 'base',
    fullPath: '../../../Engine/Config/Base.ini',
    fileName: 'Base.ini',
    type: 'ini',
    size: 1300,
    compressedSize: 900,
    physicalOrder: 1,
    source: {},
  },
];

function latestTableProps(): MockTableProps {
  const props = tableHarness.props.at(-1);
  expect(props).toBeDefined();
  return props as MockTableProps;
}

function latestColumns(): MockColumn[] {
  const columns = latestTableProps().columns;
  expect(columns).toBeDefined();
  return columns as MockColumn[];
}

function columnByKey(key: string): MockColumn {
  const column = latestColumns().find((candidate) => candidate.key === key);
  expect(column).toBeDefined();
  return column as MockColumn;
}

function sorterByKey(key: string): (left: PackageRow, right: PackageRow) => number {
  const sorter = columnByKey(key).sorter;
  expect(sorter).toEqual(expect.any(Function));
  return sorter as (left: PackageRow, right: PackageRow) => number;
}

function renderPackageTable({
  tableRows = rows,
  sortState = PACKAGE_TABLE_DEFAULT_SORT,
  onSortChange = () => {},
}: {
  tableRows?: PackageRow[];
  sortState?: PackageTableSortState;
  onSortChange?: (sortState: PackageTableSortState) => void;
} = {}) {
  return render(
    <PackageTable
      rows={tableRows}
      height={420}
      sortState={sortState}
      onSelectPackage={() => {}}
      onSortChange={onSortChange}
    />,
  );
}

function renderColumnText(column: MockColumn, value: unknown, row: PackageRow): string {
  const rendered = column.render?.(value, row);

  if (rendered === undefined || rendered === null || typeof rendered === 'boolean') {
    return '';
  }

  if (typeof rendered === 'string' || typeof rendered === 'number') {
    return String(rendered);
  }

  const { container } = render(<>{rendered}</>);
  return container.textContent ?? '';
}

function packageRow(overrides: Partial<PackageRow>): PackageRow {
  return {
    id: overrides.id ?? 'row',
    fullPath: overrides.fullPath ?? `../../../Game/${overrides.fileName ?? 'Row.uasset'}`,
    fileName: overrides.fileName ?? 'Row.uasset',
    source: {},
    ...overrides,
  };
}

describe('PackageTable', () => {
  beforeEach(() => {
    tableHarness.props = [];
  });

  test('configures the required Ant Design table props and virtual table geometry', () => {
    renderPackageTable();

    const table = screen.getByTestId('mock-table');
    expect(table).toHaveAttribute('data-bordered', 'true');
    expect(table).toHaveAttribute('data-pagination', 'false');
    expect(table).toHaveAttribute('data-scroll-x', '880');
    expect(table).toHaveAttribute('data-scroll-y', '420');
    expect(table).toHaveAttribute('data-size', 'small');
    expect(table).toHaveAttribute('data-table-layout', 'auto');
    expect(table).toHaveAttribute('data-row-key', 'id');
    expect(table).toHaveAttribute('data-virtual', 'true');
  });

  test('configures the exact package table column order and contracts', () => {
    renderPackageTable();

    const columns = latestColumns();
    expect(columns.map(({ dataIndex, key, title, width }) => ({ dataIndex, key, title, width }))).toEqual(
      PACKAGE_TABLE_COLUMNS.map(({ dataIndex, key, title, width }) => ({ dataIndex, key, title, width })),
    );
    expect(columns.some((column) => column.key === 'type' || column.title === 'Type')).toBe(false);

    const firstColumn = columns[0];
    expect(firstColumn).toMatchObject({
      title: 'Full Path',
      dataIndex: 'fullPath',
      key: 'fullPath',
      fixed: 'left',
      ellipsis: false,
      width: 520,
      className: 'package-path-column',
    });

    const pathCell = screen.getByTitle('../../../Engine/Config/Base.ini');
    expect(pathCell).toHaveClass('package-path-cell');
    expect(pathCell).toHaveTextContent('../../../Engine/Config/Base.ini');

    expect(columnByKey('size').sorter).toEqual(expect.any(Function));
    expect(columnByKey('compressedSize').sorter).toEqual(expect.any(Function));
    expect(columnByKey('physicalOrder').sorter).toEqual(expect.any(Function));
  });

  test('sorts the data source by the controlled physical order default before rendering', () => {
    const physicalRows = [
      packageRow({ id: 'alpha', fileName: 'Alpha.uasset', physicalOrder: 9 }),
      packageRow({ id: 'zeta', fileName: 'Zeta.uasset', physicalOrder: 1 }),
    ];
    renderPackageTable({ tableRows: physicalRows });

    expect(latestTableProps().dataSource?.map((row) => row.fileName)).toEqual(['Zeta.uasset', 'Alpha.uasset']);
  });

  test('sorts numeric columns ascending, places missing values last, and falls back to file name ties', () => {
    renderPackageTable();

    const low = packageRow({
      id: 'low',
      fileName: 'Low.uasset',
      size: 100,
      compressedSize: 50,
      physicalOrder: 1,
    });
    const high = packageRow({
      id: 'high',
      fileName: 'High.uasset',
      size: 200,
      compressedSize: 75,
      physicalOrder: 2,
    });
    const missing = packageRow({
      id: 'missing',
      fileName: 'Missing.uasset',
    });
    const alphaTie = packageRow({
      id: 'alpha-tie',
      fileName: 'Alpha.uasset',
      size: 100,
      compressedSize: 50,
      physicalOrder: 1,
    });

    (['size', 'compressedSize', 'physicalOrder'] as const).forEach((key) => {
      const sorter = sorterByKey(key);
      expect(sorter(low, high)).toBeLessThan(0);
      expect(sorter(high, low)).toBeGreaterThan(0);
      expect(sorter(low, missing)).toBeLessThan(0);
      expect(sorter(missing, low)).toBeGreaterThan(0);
      expect(sorter(alphaTie, low)).toBeLessThan(0);
    });
  });

  test('marks the controlled Order column as sorted by default', () => {
    renderPackageTable();

    expect(columnByKey('physicalOrder').sortOrder).toBe('ascend');
    expect(columnByKey('size').sortOrder).toBeUndefined();
  });

  test('reports Ant table sort changes using the shared package table sort state', () => {
    const onSortChange = vi.fn();
    renderPackageTable({ onSortChange });

    latestTableProps().onChange?.({}, {}, { columnKey: 'size', order: 'descend' });

    expect(onSortChange).toHaveBeenCalledWith({ columnKey: 'size', order: 'descend' });
  });

  test('reports default sort when Ant table sorting is cleared or unsupported', () => {
    const onSortChange = vi.fn();
    renderPackageTable({ onSortChange });

    latestTableProps().onChange?.({}, {}, { columnKey: 'size', order: null });
    latestTableProps().onChange?.({}, {}, { columnKey: 'type', order: 'ascend' });

    expect(onSortChange).toHaveBeenNthCalledWith(1, PACKAGE_TABLE_DEFAULT_SORT);
    expect(onSortChange).toHaveBeenNthCalledWith(2, PACKAGE_TABLE_DEFAULT_SORT);
  });

  test('renders package paths, byte counts, and blank missing order values', () => {
    renderPackageTable();

    expect(renderColumnText(columnByKey('size'), 3000, rows[0])).toBe('2.93 KB');
    expect(renderColumnText(columnByKey('compressedSize'), 1200, rows[0])).toBe('1.17 KB');
    expect(renderColumnText(columnByKey('physicalOrder'), undefined, packageRow({
      id: 'missing-order',
      fileName: 'MissingOrder.uasset',
    }))).toBe('');
  });

  test('selects the package when a rendered row is clicked', () => {
    const onSelectPackage = vi.fn();
    render(
      <PackageTable
        rows={rows}
        height={320}
        sortState={PACKAGE_TABLE_DEFAULT_SORT}
        onSelectPackage={onSelectPackage}
        onSortChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('row-base'));

    expect(onSelectPackage).toHaveBeenCalledWith(rows[1]);
  });

  test('shows the empty package message when there are no rows', () => {
    renderPackageTable({ tableRows: [] });

    expect(screen.getByText('No packages to show.')).toBeInTheDocument();
  });
});
