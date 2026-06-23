import { describe, expect, test } from 'vitest';
import {
  VISIBLE_TREE_ROW_HEIGHT,
  flattenVisibleTreeRows,
  visibleTreeParentTrail,
  type VisibleTreeNode,
} from './visibleTreeParents';

const treeData: VisibleTreeNode[] = [
  {
    key: 'root',
    title: 'Root',
    children: [
      { key: 'root/a.pak', title: 'A.pak' },
      {
        key: 'root/nested',
        title: 'Nested',
        children: [
          { key: 'root/nested/global.utoc', title: 'global.utoc' },
        ],
      },
    ],
  },
];

describe('visibleTreeParents', () => {
  test('flattens expanded tree rows with their parent titles', () => {
    expect(flattenVisibleTreeRows(treeData, ['root', 'root/nested'])).toEqual([
      { key: 'root', title: 'Root', parentTitles: [], hasChildren: true },
      { key: 'root/a.pak', title: 'A.pak', parentTitles: ['Root'], hasChildren: false },
      { key: 'root/nested', title: 'Nested', parentTitles: ['Root'], hasChildren: true },
      {
        key: 'root/nested/global.utoc',
        title: 'global.utoc',
        parentTitles: ['Root', 'Nested'],
        hasChildren: false,
      },
    ]);
  });

  test('uses the current visible file row to show its parent chain', () => {
    const rows = flattenVisibleTreeRows(treeData, ['root', 'root/nested']);

    expect(visibleTreeParentTrail(rows, VISIBLE_TREE_ROW_HEIGHT * 3)).toEqual(['Root', 'Nested']);
  });

  test('uses the current visible directory row as the active branch context', () => {
    const rows = flattenVisibleTreeRows(treeData, ['root', 'root/nested']);

    expect(visibleTreeParentTrail(rows, VISIBLE_TREE_ROW_HEIGHT * 2)).toEqual(['Root', 'Nested']);
  });

  test('omits children hidden behind collapsed parents', () => {
    expect(flattenVisibleTreeRows(treeData, ['root']).map((row) => row.key)).toEqual([
      'root',
      'root/a.pak',
      'root/nested',
    ]);
  });
});
