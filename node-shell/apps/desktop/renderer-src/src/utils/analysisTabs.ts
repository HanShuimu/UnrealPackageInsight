import type { AnalysisResult } from '../types/upi';

export type AnalysisTabModel =
  | { id: 'overview'; label: 'Overview'; kind: 'overview' }
  | { id: 'packages'; label: 'Packages'; kind: 'table'; field: 'packages' }
  | { id: 'chunks'; label: 'Chunks'; kind: 'table'; field: 'chunks' }
  | { id: 'partitions'; label: 'Partitions'; kind: 'table'; field: 'partitions' }
  | { id: 'blocks'; label: 'Blocks'; kind: 'table'; field: 'compressedBlocks' }
  | { id: 'issues'; label: 'Issues'; kind: 'issues' }
  | { id: 'raw'; label: 'Raw'; kind: 'raw' };

const OVERVIEW_TAB: AnalysisTabModel = { id: 'overview', label: 'Overview', kind: 'overview' };
const PACKAGES_TAB: AnalysisTabModel = { id: 'packages', label: 'Packages', kind: 'table', field: 'packages' };
const CHUNKS_TAB: AnalysisTabModel = { id: 'chunks', label: 'Chunks', kind: 'table', field: 'chunks' };
const PARTITIONS_TAB: AnalysisTabModel = { id: 'partitions', label: 'Partitions', kind: 'table', field: 'partitions' };
const BLOCKS_TAB: AnalysisTabModel = { id: 'blocks', label: 'Blocks', kind: 'table', field: 'compressedBlocks' };
const ISSUES_TAB: AnalysisTabModel = { id: 'issues', label: 'Issues', kind: 'issues' };
const RAW_TAB: AnalysisTabModel = { id: 'raw', label: 'Raw', kind: 'raw' };

export function buildAnalysisTabs(result: AnalysisResult | null): AnalysisTabModel[] {
  if (!result) {
    return [];
  }

  if (Array.isArray(result.chunks)) {
    return [
      OVERVIEW_TAB,
      PACKAGES_TAB,
      CHUNKS_TAB,
      ...(Array.isArray(result.partitions) ? [PARTITIONS_TAB] : []),
      BLOCKS_TAB,
      ISSUES_TAB,
    ];
  }

  if (Array.isArray(result.packages) && Array.isArray(result.compressedBlocks)) {
    return [OVERVIEW_TAB, PACKAGES_TAB, BLOCKS_TAB, ISSUES_TAB];
  }

  if (Array.isArray(result.issues) && result.issues.length > 0) {
    return [ISSUES_TAB];
  }

  return [RAW_TAB];
}
