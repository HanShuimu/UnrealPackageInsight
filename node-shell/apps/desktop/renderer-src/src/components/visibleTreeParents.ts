import type { Key, ReactNode } from 'react';

export const VISIBLE_TREE_ROW_HEIGHT = 30;
export const VISIBLE_TREE_PARENT_TRAIL_ROW_HEIGHT = 30;
export const VISIBLE_TREE_PARENT_TRAIL_GAP = 8;

export type VisibleTreeNode = {
  key: Key;
  title?: ReactNode;
  children?: VisibleTreeNode[];
};

export type VisibleTreeRow = {
  key: string;
  title: string;
  parentTitles: string[];
  hasChildren: boolean;
};

function titleText(title: ReactNode, fallback: string): string {
  if (typeof title === 'string' || typeof title === 'number') {
    return String(title);
  }

  return fallback;
}

export function flattenVisibleTreeRows(
  nodes: VisibleTreeNode[],
  expandedKeys: Key[],
): VisibleTreeRow[] {
  const expandedKeySet = new Set(expandedKeys.map((key) => String(key)));
  const rows: VisibleTreeRow[] = [];

  const visit = (currentNodes: VisibleTreeNode[], parentTitles: string[]) => {
    currentNodes.forEach((node) => {
      const key = String(node.key);
      const title = titleText(node.title, key);
      const hasChildren = Boolean(node.children?.length);
      rows.push({ key, title, parentTitles, hasChildren });

      if (hasChildren && expandedKeySet.has(key)) {
        visit(node.children ?? [], [...parentTitles, title]);
      }
    });
  };

  visit(nodes, []);
  return rows;
}

export function visibleTreeParentTrail(
  rows: VisibleTreeRow[],
  scrollTop: number,
  rowHeight = VISIBLE_TREE_ROW_HEIGHT,
): string[] {
  if (rows.length === 0 || rowHeight <= 0) {
    return [];
  }

  const rowIndex = Math.max(0, Math.min(rows.length - 1, Math.floor(scrollTop / rowHeight)));
  const row = rows[rowIndex];

  if (row.hasChildren) {
    return [...row.parentTitles, row.title];
  }

  return row.parentTitles;
}

export function visibleTreeParentTrailHeight(trail: string[]): number {
  if (trail.length === 0) {
    return 0;
  }

  return (trail.length * VISIBLE_TREE_PARENT_TRAIL_ROW_HEIGHT) + VISIBLE_TREE_PARENT_TRAIL_GAP;
}
