import { Button, Empty, Segmented, Table, Tabs, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState, type RefCallback } from 'react';
import type { AnalysisResult } from '../types/upi';
import {
  PACKAGE_TABLE_DEFAULT_SORT,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
import {
  buildAnalysisViewModel,
  type AnalysisTabId,
  type DetailSelection,
  type IssueRow,
  type PackageMode,
  type PackageRow,
  type OverviewCard,
} from '../utils/analysisViewModel';
import { PackageContentTree } from './PackageContentTree';
import { PackageTable } from './PackageTable';

type AnalysisTabsProps = {
  result: AnalysisResult | null;
  selectedFilePath: string;
  isExtracting: boolean;
  isExportingPackagesCsv?: boolean;
  selectedPackageId: string;
  tableHeight: number;
  onDetailsSelectionChange(selection: DetailSelection | null): void;
  onExtractSelectedContainer(): void;
  onExportPackagesCsv?(rows: PackageRow[], sortState: PackageTableSortState): void;
};

const TABLE_VERTICAL_CHROME_PX = 48;

const PACKAGE_MODE_OPTIONS: Array<{ label: string; value: PackageMode }> = [
  { label: 'Table', value: 'table' },
  { label: 'Tree', value: 'tree' },
];

const ISSUE_COLUMNS: ColumnsType<IssueRow> = [
  {
    dataIndex: 'severity',
    key: 'severity',
    title: 'Severity',
    width: 120,
  },
  {
    dataIndex: 'code',
    key: 'code',
    title: 'Code',
    width: 140,
  },
  {
    dataIndex: 'message',
    key: 'message',
    title: 'Message',
  },
];

function normalizeMeasuredHeight(height: number): number {
  return Math.max(0, Math.floor(height));
}

function readElementHeight(element: HTMLElement): number {
  return element.getBoundingClientRect().height || element.clientHeight || 0;
}

function useMeasuredHeight<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [element, setElement] = useState<T | null>(null);
  const [height, setHeight] = useState(0);

  const ref = useCallback((nextElement: T | null) => {
    setElement(nextElement);
  }, []);

  useEffect(() => {
    if (!element) {
      setHeight(0);
      return undefined;
    }

    const updateHeight = (nextHeight: number) => {
      const measuredHeight = normalizeMeasuredHeight(nextHeight);
      setHeight((currentHeight) => (
        currentHeight === measuredHeight ? currentHeight : measuredHeight
      ));
    };

    updateHeight(readElementHeight(element));

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateHeight(entry?.contentRect.height ?? readElementHeight(element));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return [ref, height];
}

function tableBodyHeight(availableHeight: number): number {
  return Math.max(0, normalizeMeasuredHeight(availableHeight) - TABLE_VERTICAL_CHROME_PX);
}

function renderOverviewCards(cards: OverviewCard[]) {
  if (cards.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No summary to show." />;
  }

  return (
    <div className="summary-grid">
      {cards.map((card) => (
        <div className="summary-card" key={card.id}>
          <Typography.Text className="summary-label">{card.label}</Typography.Text>
          <Typography.Text className="summary-value">{card.value}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

type PackagePaneProps = {
  canExtract: boolean;
  canExportPackagesCsv: boolean;
  fallbackHeight: number;
  isExtracting: boolean;
  isExportingPackagesCsv: boolean;
  mode: PackageMode;
  rows: PackageRow[];
  selectedPackageId: string;
  sortState: PackageTableSortState;
  onModeChange(mode: PackageMode): void;
  onExtractSelectedContainer(): void;
  onExportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): void;
  onSelectPackage(row: PackageRow): void;
  onSortChange(sortState: PackageTableSortState): void;
};

function PackagePane({
  canExtract,
  canExportPackagesCsv,
  fallbackHeight,
  isExtracting,
  isExportingPackagesCsv,
  mode,
  rows,
  selectedPackageId,
  sortState,
  onModeChange,
  onExtractSelectedContainer,
  onExportPackagesCsv,
  onSelectPackage,
  onSortChange,
}: PackagePaneProps) {
  const [contentRef, measuredHeight] = useMeasuredHeight<HTMLDivElement>();
  const availableHeight = measuredHeight || fallbackHeight;
  const packageHeight = tableBodyHeight(availableHeight);
  const canExport = mode === 'table' && canExportPackagesCsv && !isExportingPackagesCsv;
  const handleExportPackagesCsv = useCallback(() => {
    onExportPackagesCsv(rows, sortState);
  }, [onExportPackagesCsv, rows, sortState]);

  return (
    <div className="analysis-table-pane package-pane">
      <div className="package-mode-row">
        <Segmented<PackageMode>
          options={PACKAGE_MODE_OPTIONS}
          value={mode}
          onChange={onModeChange}
        />
        <Button
          disabled={!canExport}
          loading={isExportingPackagesCsv}
          onClick={handleExportPackagesCsv}
        >
          Export CSV...
        </Button>
        <Button
          disabled={!canExtract || isExtracting}
          loading={isExtracting}
          onClick={onExtractSelectedContainer}
        >
          Extract to...
        </Button>
      </div>
      <div className="package-mode-content" ref={contentRef}>
        {mode === 'tree' ? (
          <PackageContentTree
            height={packageHeight}
            rows={rows}
            selectedPackageId={selectedPackageId}
            onSelectPackage={onSelectPackage}
          />
        ) : (
          <PackageTable
            height={packageHeight}
            rows={rows}
            sortState={sortState}
            onSelectPackage={onSelectPackage}
            onSortChange={onSortChange}
          />
        )}
      </div>
    </div>
  );
}

function IssuesTable({
  fallbackHeight,
  rows,
  onSelectIssue,
}: {
  fallbackHeight: number;
  rows: IssueRow[];
  onSelectIssue(row: IssueRow): void;
}) {
  const [paneRef, measuredHeight] = useMeasuredHeight<HTMLDivElement>();
  const availableHeight = measuredHeight || fallbackHeight;
  const issueTableHeight = tableBodyHeight(availableHeight);
  const handleRow = useCallback((row: IssueRow) => ({
    onClick: () => {
      onSelectIssue(row);
    },
  }), [onSelectIssue]);

  if (rows.length === 0) {
    return (
      <div className="analysis-table-pane" ref={paneRef}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issues to show." />
      </div>
    );
  }

  return (
    <div className="analysis-table-pane" ref={paneRef}>
      <Table<IssueRow>
        bordered
        columns={ISSUE_COLUMNS}
        dataSource={rows}
        pagination={false}
        rowKey="id"
        scroll={{ x: 760, y: issueTableHeight }}
        size="small"
        tableLayout="auto"
        virtual
        onRow={handleRow}
      />
    </div>
  );
}

export function AnalysisTabs({
  result,
  selectedFilePath,
  isExtracting,
  isExportingPackagesCsv = false,
  selectedPackageId,
  tableHeight,
  onDetailsSelectionChange,
  onExtractSelectedContainer,
  onExportPackagesCsv = () => {},
}: AnalysisTabsProps) {
  const viewModel = useMemo(() => buildAnalysisViewModel(result), [result]);
  const [activeTab, setActiveTab] = useState<AnalysisTabId>('overview');
  const [packageMode, setPackageMode] = useState<PackageMode>('table');
  const [packageSortState, setPackageSortState] = useState<PackageTableSortState>(PACKAGE_TABLE_DEFAULT_SORT);

  useEffect(() => {
    setActiveTab('overview');
    setPackageMode('table');
    setPackageSortState(PACKAGE_TABLE_DEFAULT_SORT);
    onDetailsSelectionChange(null);
  }, [result, onDetailsSelectionChange]);

  const handleTabChange = useCallback((nextTab: string) => {
    setActiveTab(nextTab as AnalysisTabId);
  }, []);

  const handlePackageModeChange = useCallback((nextMode: PackageMode) => {
    setPackageMode(nextMode);
  }, []);

  const handleSelectPackage = useCallback((row: PackageRow) => {
    onDetailsSelectionChange({ kind: 'package', row });
  }, [onDetailsSelectionChange]);

  const handleSelectIssue = useCallback((row: IssueRow) => {
    onDetailsSelectionChange({ kind: 'issue', row });
  }, [onDetailsSelectionChange]);

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={viewModel.tabs.map((tab) => {
        if (tab.id === 'overview') {
          return {
            key: tab.id,
            label: tab.label,
            children: renderOverviewCards(viewModel.overviewCards),
          };
        }

        if (tab.id === 'packages') {
          return {
            key: tab.id,
            label: tab.label,
            children: (
              <PackagePane
                canExtract={Boolean(selectedFilePath && result && viewModel.packageRows.length > 0)}
                canExportPackagesCsv={Boolean(selectedFilePath && result && viewModel.packageRows.length > 0)}
                fallbackHeight={tableHeight}
                isExtracting={isExtracting}
                isExportingPackagesCsv={isExportingPackagesCsv}
                mode={packageMode}
                rows={viewModel.packageRows}
                selectedPackageId={selectedPackageId}
                sortState={packageSortState}
                onModeChange={handlePackageModeChange}
                onExtractSelectedContainer={onExtractSelectedContainer}
                onExportPackagesCsv={onExportPackagesCsv}
                onSelectPackage={handleSelectPackage}
                onSortChange={setPackageSortState}
              />
            ),
          };
        }

        return {
          key: tab.id,
          label: tab.label,
          children: (
            <IssuesTable
              rows={viewModel.issueRows}
              fallbackHeight={tableHeight}
              onSelectIssue={handleSelectIssue}
            />
          ),
        };
      })}
    />
  );
}
