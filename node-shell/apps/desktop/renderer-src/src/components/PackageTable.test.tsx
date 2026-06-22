import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PackageRow } from '../utils/analysisViewModel';
import { PackageTable } from './PackageTable';

type MockColumn = {
  title?: React.ReactNode;
  dataIndex?: string;
  key?: string;
  fixed?: string;
  ellipsis?: boolean;
  width?: number;
  className?: string;
  sorter?: (left: PackageRow, right: PackageRow) => number;
  render?: (value: unknown, row: PackageRow) => React.ReactNode;
};

type MockTableProps = {
  columns?: MockColumn[];
  dataSource?: PackageRow[];
  rowKey?: string;
  scroll?: { x?: number; y?: number };
  tableLayout?: string;
  virtual?: boolean;
  onRow?: (row: PackageRow) => { onClick?: () => void };
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
          data-row-key={props.rowKey}
          data-scroll-x={String(props.scroll?.x)}
          data-scroll-y={String(props.scroll?.y)}
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

describe('PackageTable', () => {
  beforeEach(() => {
    tableHarness.props = [];
  });

  test('configures the fixed full path column and virtual table geometry', () => {
    render(<PackageTable rows={rows} height={420} onSelectPackage={() => {}} />);

    const table = screen.getByTestId('mock-table');
    expect(table).toHaveAttribute('data-scroll-x', '980');
    expect(table).toHaveAttribute('data-scroll-y', '420');
    expect(table).toHaveAttribute('data-table-layout', 'auto');
    expect(table).toHaveAttribute('data-row-key', 'id');
    expect(table).toHaveAttribute('data-virtual', 'true');

    const firstColumn = latestTableProps().columns?.[0];
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
  });

  test('sorts the data source by package file name before rendering', () => {
    render(<PackageTable rows={rows} height={320} onSelectPackage={() => {}} />);

    expect(latestTableProps().dataSource?.map((row) => row.fileName)).toEqual(['Base.ini', 'Beta.uasset']);
  });

  test('exposes numeric sorters for size, compressed size, and physical order', () => {
    render(<PackageTable rows={rows} height={320} onSelectPackage={() => {}} />);

    const columns = latestTableProps().columns ?? [];
    expect(columns.find((column) => column.key === 'size')?.sorter).toEqual(expect.any(Function));
    expect(columns.find((column) => column.key === 'compressedSize')?.sorter).toEqual(expect.any(Function));
    expect(columns.find((column) => column.key === 'physicalOrder')?.sorter).toEqual(expect.any(Function));
  });

  test('selects the package when a rendered row is clicked', () => {
    const onSelectPackage = vi.fn();
    render(<PackageTable rows={rows} height={320} onSelectPackage={onSelectPackage} />);

    fireEvent.click(screen.getByTestId('row-base'));

    expect(onSelectPackage).toHaveBeenCalledWith(rows[1]);
  });

  test('shows the empty package message when there are no rows', () => {
    render(<PackageTable rows={[]} height={320} onSelectPackage={() => {}} />);

    expect(screen.getByText('No packages to show.')).toBeInTheDocument();
  });
});
