import { describe, expect, test } from 'vitest';
import type { AnalysisResult } from '../types/upi';
import { buildAnalysisTabs, type AnalysisTabModel } from './analysisTabs';

const expectedTabIds = ['overview', 'packages', 'issues'];
const analysisTabContractIds: AnalysisTabModel['id'][] = ['overview', 'packages', 'issues'];
void analysisTabContractIds;

// @ts-expect-error raw is not part of the public analysis tabs ID contract.
const rawTabIdIsNotAnalysisTabsId: AnalysisTabModel['id'] = 'raw';
void rawTabIdIsNotAnalysisTabsId;

// @ts-expect-error raw is not part of the public analysis tabs kind contract.
const rawKindIsNotAnalysisTabsKind: AnalysisTabModel['kind'] = 'raw';
void rawKindIsNotAnalysisTabsKind;

// @ts-expect-error arbitrary tab kinds are not part of the analysis tabs contract.
const arbitraryKindIsNotAnalysisTabsKind: AnalysisTabModel['kind'] = 'arbitrary';
void arbitraryKindIsNotAnalysisTabsKind;

// @ts-expect-error raw is not part of the public analysis tabs contract.
const rawTabIsNotAnalysisTabsModel: AnalysisTabModel = { id: 'raw', label: 'Raw', kind: 'raw' };
void rawTabIsNotAnalysisTabsModel;

describe('buildAnalysisTabs', () => {
  test.each([
    ['null result', null],
    ['Pak-like result', { packages: [], compressedBlocks: [], issues: [] }],
    ['IoStore-like result', { chunks: [], packages: [], compressedBlocks: [], partitions: [], issues: [] }],
    ['issue-only result', { issues: [{ severity: 'error', message: 'Broken' }] }],
    ['unknown backend-field result', { customBackendField: [{ id: 1 }] }],
  ] satisfies Array<[string, AnalysisResult | null]>)('returns the fixed tab contract for %s', (_name, result) => {
    expect(buildAnalysisTabs(result).map((tab) => tab.id)).toEqual(expectedTabIds);
  });
});
