import { Descriptions, Empty, Tabs, Typography } from 'antd';
import { useMemo } from 'react';
import type { AnalysisResult, Issue } from '../types/upi';
import { buildAnalysisTabs, type AnalysisTabModel } from '../utils/analysisTabs';
import { formatLabel, formatValue } from '../utils/format';
import { AnalysisTable } from './AnalysisTable';

type AnalysisTabsProps = {
  result: AnalysisResult | null;
  height: number;
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

function IssuesTable({ height, issues }: { height: number; issues: Issue[] }) {
  const rows = issues.map((issue) => ({
    severity: issue.severity ?? '',
    code: issue.code ?? '',
    message: issue.message ?? '',
  }));

  return <AnalysisTable rows={rows} height={height} />;
}

function renderOverview(result: AnalysisResult) {
  const items = buildSummaryItems(result);

  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No summary to show." />;
  }

  return <Descriptions bordered column={1} items={items} size="small" />;
}

function renderTabContent(tab: AnalysisTabModel, result: AnalysisResult, height: number) {
  switch (tab.kind) {
    case 'overview':
      return renderOverview(result);
    case 'table':
      return <AnalysisTable rows={result[tab.field] ?? []} height={height} />;
    case 'issues':
      return <IssuesTable issues={result.issues ?? []} height={height} />;
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

export function AnalysisTabs({ result, height }: AnalysisTabsProps) {
  const tabModels = useMemo(() => buildAnalysisTabs(result), [result]);

  if (!result || tabModels.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No analysis result to show." />;
  }

  return (
    <Tabs
      items={tabModels.map((tab) => ({
        key: tab.id,
        label: tab.label,
        children: renderTabContent(tab, result, height),
      }))}
    />
  );
}
