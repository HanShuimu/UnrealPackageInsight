import { describe, expect, test } from 'vitest';
import type { AnalysisResult } from '../types/upi';
import { buildAnalysisTabs } from './analysisTabs';

const expectedTabIds = ['overview', 'packages', 'issues'];

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
