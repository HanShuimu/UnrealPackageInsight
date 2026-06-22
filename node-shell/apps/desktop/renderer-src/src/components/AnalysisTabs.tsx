import { Empty, Tabs, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState, type RefCallback } from 'react';
import type { AnalysisResult, Issue } from '../types/upi';
import { buildAnalysisTabs, type AnalysisTabModel } from '../utils/analysisTabs';
import { formatLabel, formatValue } from '../utils/format';
import { AnalysisTable } from './AnalysisTable';

type AnalysisTabsProps = {
  result: AnalysisResult | null;
  tableHeight: number;
};

type SummaryItem = {
  key: string;
  label: string;
  children: string;
};

const SUMMARY_EXCLUDED_KEYS = new Set([
  'issues',
  'packages',
  'chunks',
  'compressedBlocks',
  'partitions',
  'backendSelection',
]);
const TABLE_VERTICAL_CHROME_PX = 48;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildSummaryItems(result: AnalysisResult): SummaryItem[] {
  const items = new Map<string, unknown>();

  Object.entries(result).forEach(([key, value]) => {
    if (key !== 'overview' && !SUMMARY_EXCLUDED_KEYS.has(key)) {
      items.set(key, value);
    }
  });

  if (isRecord(result.overview)) {
    Object.entries(result.overview).forEach(([key, value]) => {
      items.set(key, value);
    });
  }

  return Array.from(items.entries()).map(([key, value]) => ({
    key,
    label: formatLabel(key),
    children: formatValue(value),
  }));
}

function TablePane({ fallbackHeight, rows }: { fallbackHeight: number; rows: unknown[] }) {
  const [paneRef, measuredHeight] = useMeasuredHeight<HTMLDivElement>();
  const availableHeight = measuredHeight || fallbackHeight;

  return (
    <div className="analysis-table-pane" ref={paneRef}>
      <AnalysisTable rows={rows} height={tableBodyHeight(availableHeight)} />
    </div>
  );
}

function IssuesTable({ fallbackHeight, issues }: { fallbackHeight: number; issues: Issue[] }) {
  const rows = issues.map((issue) => ({
    severity: issue.severity ?? '',
    code: issue.code ?? '',
    message: issue.message ?? '',
  }));

  return <TablePane rows={rows} fallbackHeight={fallbackHeight} />;
}

function renderOverview(result: AnalysisResult) {
  const items = buildSummaryItems(result);

  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No summary to show." />;
  }

  return (
    <div className="summary-grid">
      {items.map((item) => (
        <div className="summary-card" key={item.key}>
          <Typography.Text className="summary-label">{item.label}</Typography.Text>
          <Typography.Text className="summary-value">{item.children}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

function renderEmptyWorkspace() {
  return (
    <div className="empty-tab-region">
      <Typography.Title className="empty-tab-title" level={3}>
        Tab content region
      </Typography.Title>
      <Typography.Text className="empty-tab-subtitle">
        Replace with Pak or IoStore tab variants
      </Typography.Text>
    </div>
  );
}

function renderTabContent(tab: AnalysisTabModel, result: AnalysisResult, height: number) {
  switch (tab.kind) {
    case 'overview':
      return renderOverview(result);
    case 'table':
      return <TablePane rows={result[tab.field] ?? []} fallbackHeight={height} />;
    case 'issues':
      return <IssuesTable issues={result.issues ?? []} fallbackHeight={height} />;
    case 'raw':
      return (
        <Typography.Paragraph code>
          {formatValue(result)}
        </Typography.Paragraph>
      );
    default:
      return null;
  }
}

export function AnalysisTabs({ result, tableHeight }: AnalysisTabsProps) {
  const tabModels = useMemo(() => buildAnalysisTabs(result), [result]);

  if (!result) {
    return (
      <Tabs
        items={[
          { key: 'overview', label: 'Overview', children: renderEmptyWorkspace() },
          { key: 'packages', label: 'Packages', children: renderEmptyWorkspace() },
          { key: 'issues', label: 'Issues', children: renderEmptyWorkspace() },
        ]}
      />
    );
  }

  if (tabModels.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No analysis result to show." />;
  }

  return (
    <Tabs
      items={tabModels.map((tab) => ({
        key: tab.id,
        label: tab.label,
        children: renderTabContent(tab, result, tableHeight),
      }))}
    />
  );
}
