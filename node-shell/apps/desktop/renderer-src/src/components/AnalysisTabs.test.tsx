import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { DetailSelection, IssueRow, PackageRow } from '../utils/analysisViewModel';
import type { AnalysisResult } from '../types/upi';
import { AnalysisTabs } from './AnalysisTabs';

type ObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

type MockColumn = {
  dataIndex?: keyof IssueRow;
  key?: string;
  title?: React.ReactNode;
};

type MockTableProps = {
  columns?: MockColumn[];
  dataSource?: IssueRow[];
  onRow?: (row: IssueRow) => { onClick?: () => void };
  pagination?: false;
  rowKey?: string;
  scroll?: { y?: number };
  size?: string;
};

type PackageTableProbeProps = {
  rows: PackageRow[];
  height: number;
  onSelectPackage(row: PackageRow): void;
};

type PackageTreeProbeProps = PackageTableProbeProps & {
  selectedPackageId: string;
};

const harness = vi.hoisted(() => ({
  observers: [] as ObserverRecord[],
  packageTableProps: [] as PackageTableProbeProps[],
  packageTreeProps: [] as PackageTreeProbeProps[],
  tableProps: [] as MockTableProps[],
}));

class ResizeObserverMock implements ResizeObserver {
  private readonly record: ObserverRecord;

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: new Set<Element>() };
    harness.observers.push(this.record);
  }

  disconnect(): void {
    this.record.targets.clear();
  }

  observe(target: Element): void {
    this.record.targets.add(target);
  }

  unobserve(target: Element): void {
    this.record.targets.delete(target);
  }
}

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  type TabItem = {
    children?: React.ReactNode;
    key: string;
    label: React.ReactNode;
  };

  type TabsProps = {
    activeKey?: string;
    items?: TabItem[];
    onChange?(key: string): void;
  };

  type SegmentedOption = string | { label: React.ReactNode; value: string };

  type SegmentedProps = {
    options?: SegmentedOption[];
    value?: string;
    onChange?(value: string): void;
  };

  return {
    ...actual,
    Empty: ({ description }: { description?: React.ReactNode }) => (
      <div data-testid="empty-state">{description}</div>
    ),
    Segmented: ({ options = [], value, onChange }: SegmentedProps) => (
      <div aria-label="Package mode" role="group">
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const label = typeof option === 'string' ? option : option.label;

          return (
            <button
              aria-pressed={value === optionValue}
              key={optionValue}
              type="button"
              onClick={() => onChange?.(optionValue)}
            >
              {label}
            </button>
          );
        })}
      </div>
    ),
    Table: (props: MockTableProps) => {
      harness.tableProps.push(props);

      return (
        <table
          data-testid="issues-table"
          data-row-count={props.dataSource?.length ?? 0}
          data-scroll-y={props.scroll?.y}
        >
          <thead>
            <tr>
              {props.columns?.map((column) => (
                <th key={column.key}>{column.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.dataSource?.map((row, rowIndex) => {
              const rowEvents = props.onRow?.(row) ?? {};

              return (
                <tr key={String(row.id ?? rowIndex)} onClick={rowEvents.onClick}>
                  {props.columns?.map((column) => (
                    <td key={column.key}>
                      {column.dataIndex ? String(row[column.dataIndex] ?? '') : ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    },
    Tabs: ({ activeKey, items = [], onChange }: TabsProps) => {
      const selectedKey = activeKey ?? items[0]?.key ?? '';
      const selectedItem = items.find((item) => item.key === selectedKey) ?? items[0];

      return (
        <div>
          <div role="tablist">
            {items.map((item) => (
              <button
                aria-selected={item.key === selectedKey}
                key={item.key}
                role="tab"
                type="button"
                onClick={() => onChange?.(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <section data-active-key={selectedKey} data-testid="active-tab">
            {selectedItem?.children}
          </section>
        </div>
      );
    },
    Typography: {
      Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    },
  };
});

vi.mock('./PackageTable', () => ({
  PackageTable: (props: PackageTableProbeProps) => {
    harness.packageTableProps.push(props);

    return (
      <div
        data-height={props.height}
        data-row-count={props.rows.length}
        data-testid="package-table"
      >
        <button
          disabled={props.rows.length === 0}
          type="button"
          onClick={() => {
            const row = props.rows[0];
            if (row) {
              props.onSelectPackage(row);
            }
          }}
        >
          Select first package
        </button>
      </div>
    );
  },
}));

vi.mock('./PackageContentTree', () => ({
  PackageContentTree: (props: PackageTreeProbeProps) => {
    harness.packageTreeProps.push(props);

    return (
      <div
        data-height={props.height}
        data-row-count={props.rows.length}
        data-selected-package-id={props.selectedPackageId}
        data-testid="package-content-tree"
      />
    );
  },
}));

const fooPath = '../../../Game/Content/Foo.uasset';
const barPath = '../../../Game/Content/Bar.uasset';

function analysisResult(path = fooPath): AnalysisResult {
  return {
    overview: {
      packageCount: 1,
      totalSize: 2048,
    },
    packages: [
      {
        packagePath: path,
        size: 2048,
        compressedSize: 1024,
        order: 7,
      },
    ],
    issues: [],
  };
}

function renderTabs(
  result: AnalysisResult | null,
  options: {
    onDetailsSelectionChange?: (selection: DetailSelection | null) => void;
    selectedPackageId?: string;
    tableHeight?: number;
  } = {},
) {
  return render(
    <AnalysisTabs
      result={result}
      selectedPackageId={options.selectedPackageId ?? ''}
      tableHeight={options.tableHeight ?? 500}
      onDetailsSelectionChange={options.onDetailsSelectionChange ?? (() => {})}
    />,
  );
}

function tabLabels(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
}

function activeTabKey(): string {
  return screen.getByTestId('active-tab').dataset.activeKey ?? '';
}

function resizeElement(selector: string, height: number): void {
  const targets = Array.from(document.querySelectorAll(selector));

  if (targets.length === 0) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  act(() => {
    harness.observers.forEach((observer) => {
      const entries = targets
        .filter((target) => observer.targets.has(target))
        .map((target) => ({
          contentRect: { height },
          target,
        } as ResizeObserverEntry));

      if (entries.length > 0) {
        observer.callback(entries, {} as ResizeObserver);
      }
    });
  });
}

describe('AnalysisTabs', () => {
  beforeEach(() => {
    harness.observers.length = 0;
    harness.packageTableProps.length = 0;
    harness.packageTreeProps.length = 0;
    harness.tableProps.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  test('renders only the UPI Final top-level tab labels for empty and real results', () => {
    const { rerender } = renderTabs(null);

    expect(tabLabels()).toEqual(['Overview', 'Packages', 'Issues']);
    expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
    expect(screen.queryByText('Chunks')).not.toBeInTheDocument();
    expect(screen.queryByText('Partitions')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw')).not.toBeInTheDocument();
    expect(screen.queryByText('Tab content region')).not.toBeInTheDocument();
    expect(screen.queryByText('Replace with Pak or IoStore tab variants')).not.toBeInTheDocument();

    rerender(
      <AnalysisTabs
        result={analysisResult()}
        selectedPackageId=""
        tableHeight={500}
        onDetailsSelectionChange={() => {}}
      />,
    );

    expect(tabLabels()).toEqual(['Overview', 'Packages', 'Issues']);
    expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
    expect(screen.queryByText('Chunks')).not.toBeInTheDocument();
    expect(screen.queryByText('Partitions')).not.toBeInTheDocument();
    expect(screen.queryByText('Raw')).not.toBeInTheDocument();
  });

  test('defaults to overview and resets overview plus details selection when result changes', () => {
    const onDetailsSelectionChange = vi.fn();
    const { rerender } = renderTabs(analysisResult(fooPath), { onDetailsSelectionChange });

    expect(activeTabKey()).toBe('overview');

    fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
    expect(activeTabKey()).toBe('packages');

    onDetailsSelectionChange.mockClear();
    rerender(
      <AnalysisTabs
        result={analysisResult(barPath)}
        selectedPackageId=""
        tableHeight={500}
        onDetailsSelectionChange={onDetailsSelectionChange}
      />,
    );

    expect(activeTabKey()).toBe('overview');
    expect(onDetailsSelectionChange).toHaveBeenCalledWith(null);
  });

  test('overview renders available summary cards only and no size breakdown section', () => {
    renderTabs({
      overview: {
        packageCount: 2,
        totalSize: 4096,
      },
      packages: [
        { packagePath: fooPath, size: 2048 },
        { packagePath: barPath, size: 2048 },
      ],
    });

    const activeTab = within(screen.getByTestId('active-tab'));
    expect(activeTab.getByText('Packages')).toBeInTheDocument();
    expect(activeTab.getByText('2')).toBeInTheDocument();
    expect(activeTab.getByText('Total Size')).toBeInTheDocument();
    expect(activeTab.getByText('4.00 KB')).toBeInTheDocument();
    expect(activeTab.queryByText('Compressed Size')).not.toBeInTheDocument();
    expect(activeTab.queryByText('Issues')).not.toBeInTheDocument();
    expect(screen.queryByText('Size Breakdown')).not.toBeInTheDocument();
  });

  test('issues do not auto-select the Issues tab and an empty Issues state can render', () => {
    const { rerender } = renderTabs(null);

    rerender(
      <AnalysisTabs
        result={{
          overview: { issueCount: 1 },
          issues: [{ severity: 'warning', code: 'UPI001', message: 'Needs attention' }],
          packages: [],
        }}
        selectedPackageId=""
        tableHeight={500}
        onDetailsSelectionChange={() => {}}
      />,
    );

    expect(activeTabKey()).toBe('overview');
    expect(screen.queryByTestId('issues-table')).not.toBeInTheDocument();

    rerender(
      <AnalysisTabs
        result={{ overview: {}, issues: [], packages: [] }}
        selectedPackageId=""
        tableHeight={500}
        onDetailsSelectionChange={() => {}}
      />,
    );

    expect(activeTabKey()).toBe('overview');
    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));
    expect(screen.getByText('No issues to show.')).toBeInTheDocument();
  });

  test('packages default to Table mode, switch to Tree, and reset to Table when result changes', () => {
    const { rerender } = renderTabs(analysisResult(fooPath), {
      selectedPackageId: fooPath,
      tableHeight: 500,
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
    expect(screen.getByTestId('package-table')).toHaveAttribute('data-height', '452');
    expect(screen.queryByTestId('package-content-tree')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByTestId('package-content-tree')).toHaveAttribute('data-selected-package-id', fooPath);
    expect(screen.queryByTestId('package-table')).not.toBeInTheDocument();

    rerender(
      <AnalysisTabs
        result={analysisResult(barPath)}
        selectedPackageId=""
        tableHeight={500}
        onDetailsSelectionChange={() => {}}
      />,
    );

    expect(activeTabKey()).toBe('overview');

    fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
    expect(screen.getByTestId('package-table')).toHaveAttribute('data-row-count', '1');
    expect(screen.queryByTestId('package-content-tree')).not.toBeInTheDocument();
  });

  test('sizes the package table from the measured package content height', async () => {
    renderTabs(analysisResult(), { tableHeight: 333 });

    fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
    expect(screen.getByTestId('package-table')).toHaveAttribute('data-height', '285');

    resizeElement('.package-mode-content', 360);

    await waitFor(() => {
      expect(screen.getByTestId('package-table')).toHaveAttribute('data-height', '312');
    });
  });

  test('issues render only severity, code, and message table fields', () => {
    renderTabs({
      overview: {},
      packages: [],
      issues: [
        {
          severity: 'error',
          code: 'UPI002',
          message: 'Package index is invalid',
        },
      ],
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));

    const issueTable = screen.getByTestId('issues-table');
    expect(within(issueTable).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Severity',
      'Code',
      'Message',
    ]);
    expect(issueTable).toHaveTextContent('error');
    expect(issueTable).toHaveTextContent('UPI002');
    expect(issueTable).toHaveTextContent('Package index is invalid');
    expect(issueTable).not.toHaveTextContent('source');
  });

  test('selecting a package from the table reports a package row detail selection', () => {
    const onDetailsSelectionChange = vi.fn();
    renderTabs(analysisResult(fooPath), { onDetailsSelectionChange });

    onDetailsSelectionChange.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: 'Packages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select first package' }));

    expect(onDetailsSelectionChange).toHaveBeenCalledWith({
      kind: 'package',
      row: expect.objectContaining({
        id: fooPath,
        fullPath: fooPath,
        fileName: 'Foo.uasset',
        size: 2048,
        compressedSize: 1024,
        physicalOrder: 7,
      }),
    });
  });

  test('selecting an issue row reports an issue row detail selection', () => {
    const onDetailsSelectionChange = vi.fn();
    renderTabs({
      overview: {},
      packages: [],
      issues: [
        {
          severity: 'error',
          code: 'UPI002',
          message: 'Package index is invalid',
        },
      ],
    }, { onDetailsSelectionChange });

    onDetailsSelectionChange.mockClear();
    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));
    fireEvent.click(screen.getByText('Package index is invalid'));

    expect(onDetailsSelectionChange).toHaveBeenCalledWith({
      kind: 'issue',
      row: expect.objectContaining({
        id: 'issue-1',
        severity: 'error',
        code: 'UPI002',
        message: 'Package index is invalid',
      }),
    });
  });
});
