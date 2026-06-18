import { describe, expect, test } from 'vitest';
import { buildAnalysisTabs } from './analysisTabs';

describe('buildAnalysisTabs', () => {
  test('builds IoStore tabs when chunks are present', () => {
    expect(buildAnalysisTabs({ chunks: [], packages: [], compressedBlocks: [], issues: [] }).map((tab) => tab.id))
      .toEqual(['overview', 'packages', 'chunks', 'blocks', 'issues']);
  });

  test('adds a partitions tab for IoStore results with partitions', () => {
    expect(
      buildAnalysisTabs({
        chunks: [],
        packages: [],
        compressedBlocks: [],
        partitions: [],
        issues: [],
      }).map((tab) => tab.id),
    ).toEqual(['overview', 'packages', 'chunks', 'partitions', 'blocks', 'issues']);
  });

  test('builds Pak tabs when packages and compressed blocks are present without chunks', () => {
    expect(buildAnalysisTabs({ packages: [], compressedBlocks: [], issues: [] }).map((tab) => tab.id))
      .toEqual(['overview', 'packages', 'blocks', 'issues']);
  });
});
