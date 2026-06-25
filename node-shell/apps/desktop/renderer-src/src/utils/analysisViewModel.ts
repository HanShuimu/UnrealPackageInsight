import type { AnalysisResult } from '../types/upi';
import {
  buildPackageRows as buildSharedPackageRows,
  comparePackageFileName,
  comparePackageOrder,
  type PackageRow,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';

export type AnalysisTabId = 'overview' | 'packages' | 'issues';
export type PackageMode = 'table' | 'tree';

type ContractAnalysisTabModel =
  | { id: 'overview'; label: 'Overview'; kind: 'overview' }
  | { id: 'packages'; label: 'Packages'; kind: 'table'; field: 'packages' }
  | { id: 'issues'; label: 'Issues'; kind: 'issues' };

export type AnalysisTabModel = ContractAnalysisTabModel;

export type OverviewCard = {
  id: 'packages' | 'totalSize' | 'compressedSize' | 'issues';
  label: string;
  value: string;
};

export type { PackageRow };
export { comparePackageFileName, comparePackageOrder };

export type PackageTreeItem = {
  key: string;
  title: string;
  children?: PackageTreeItem[];
  packageRowId?: string;
  selectable?: boolean;
};

export type IssueRow = {
  id: string;
  severity: string | number | '';
  code: string;
  message: string;
  source: unknown;
};

export type DetailSelection =
  | { kind: 'package'; row: PackageRow }
  | { kind: 'issue'; row: IssueRow };

export type AnalysisViewModel = {
  tabs: ContractAnalysisTabModel[];
  overviewCards: OverviewCard[];
  packageRows: PackageRow[];
  packageTree: PackageTreeItem[];
  issueRows: IssueRow[];
  packageMode: PackageMode;
  detailSelection: DetailSelection | null;
};

export const ANALYSIS_TABS: ContractAnalysisTabModel[] = [
  { id: 'overview', label: 'Overview', kind: 'overview' },
  { id: 'packages', label: 'Packages', kind: 'table', field: 'packages' },
  { id: 'issues', label: 'Issues', kind: 'issues' },
];

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  return undefined;
}

function pathSegments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
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

function sumKnown(values: Array<number | undefined>): number | undefined {
  let found = false;
  let total = 0;

  values.forEach((value) => {
    if (value !== undefined) {
      found = true;
      total += value;
    }
  });

  return found ? total : undefined;
}

function comparePackageTreeItem(left: PackageTreeItem, right: PackageTreeItem): number {
  return compareText(left.title, right.title) || compareText(left.key, right.key);
}

function sortPackageTreeItems(items: PackageTreeItem[]): PackageTreeItem[] {
  items.sort(comparePackageTreeItem);
  items.forEach((item) => {
    if (item.children) {
      sortPackageTreeItems(item.children);
    }
  });

  return items;
}

export function buildPackageRows(result: AnalysisResult | null): PackageRow[] {
  return buildSharedPackageRows(result);
}

export function buildOverviewCards(result: AnalysisResult | null): OverviewCard[] {
  if (!result) {
    return [];
  }

  const overview = isRecord(result.overview) ? result.overview : {};
  const packageRows = buildPackageRows(result);
  const packageCount = toFiniteNumber(overview.packageCount)
    ?? (Array.isArray(result.packages) ? packageRows.length : undefined);
  const totalSize = toFiniteNumber(overview.totalSize)
    ?? sumKnown(packageRows.map((row) => row.size));
  const compressedSize = toFiniteNumber(overview.compressedSize ?? overview.totalCompressedSize)
    ?? sumKnown(packageRows.map((row) => row.compressedSize));
  const issueCount = toFiniteNumber(overview.issueCount)
    ?? (Array.isArray(result.issues) ? result.issues.length : undefined);
  const cards: OverviewCard[] = [];

  if (packageCount !== undefined) {
    cards.push({ id: 'packages', label: 'Packages', value: String(packageCount) });
  }

  if (totalSize !== undefined) {
    cards.push({ id: 'totalSize', label: 'Total Size', value: formatBytes(totalSize) });
  }

  if (compressedSize !== undefined) {
    cards.push({ id: 'compressedSize', label: 'Compressed Size', value: formatBytes(compressedSize) });
  }

  if (issueCount !== undefined) {
    cards.push({ id: 'issues', label: 'Issues', value: String(issueCount) });
  }

  return cards;
}

export function buildIssueRows(result: AnalysisResult | null): IssueRow[] {
  const issues = Array.isArray(result?.issues) ? result.issues : [];

  return issues.map((issue, index) => {
    const source = isRecord(issue) ? issue : {};

    return {
      id: `issue-${index + 1}`,
      severity: source.severity === undefined ? '' : String(source.severity),
      code: source.code === undefined ? '' : String(source.code),
      message: source.message === undefined ? '' : String(source.message),
      source: issue,
    };
  });
}

export function buildPackageTree(rows: PackageRow[]): PackageTreeItem[] {
  const roots: PackageTreeItem[] = [];
  const nodesByKey = new Map<string, PackageTreeItem>();
  const leafKeyCounts = new Map<string, number>();

  rows.forEach((row) => {
    const leafKey = pathSegments(row.fullPath).join('/');
    leafKeyCounts.set(leafKey, (leafKeyCounts.get(leafKey) ?? 0) + 1);
  });

  rows.forEach((row) => {
    const segments = pathSegments(row.fullPath);
    const cumulativeSegments: string[] = [];
    let siblings = roots;

    segments.forEach((segment, index) => {
      cumulativeSegments.push(segment);

      if (segment === '.' || segment === '..') {
        return;
      }

      const isLeaf = index === segments.length - 1;
      const pathKey = cumulativeSegments.join('/');
      const key = isLeaf && (leafKeyCounts.get(pathKey) ?? 0) > 1
        ? `${pathKey}::${row.id}`
        : pathKey;
      let node = nodesByKey.get(key);

      if (!node) {
        node = { key, title: segment, selectable: isLeaf };
        nodesByKey.set(key, node);
        siblings.push(node);
      }

      if (isLeaf) {
        node.packageRowId = row.id;
        node.selectable = true;
        delete node.children;
        return;
      }

      node.selectable = false;

      if (!node.children) {
        node.children = [];
      }

      siblings = node.children;
    });
  });

  return sortPackageTreeItems(roots);
}

export function buildAnalysisViewModel(result: AnalysisResult | null): AnalysisViewModel {
  const packageRows = buildPackageRows(result);

  return {
    tabs: ANALYSIS_TABS,
    overviewCards: buildOverviewCards(result),
    packageRows,
    packageTree: buildPackageTree(packageRows),
    issueRows: buildIssueRows(result),
    packageMode: 'table',
    detailSelection: null,
  };
}
