import { Empty, Tree } from 'antd';
import type { Key, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildPackageTree, type PackageRow, type PackageTreeItem } from '../utils/analysisViewModel';
import { VisibleTreeParentTrail } from './VisibleTreeParentTrail';
import {
  flattenVisibleTreeRows,
  visibleTreeParentTrail,
  visibleTreeParentTrailHeight,
} from './visibleTreeParents';

type PackageContentTreeProps = {
  rows: PackageRow[];
  height: number;
  selectedPackageId: string;
  onSelectPackage(row: PackageRow): void;
};

type PackageContentTreeState = {
  expandedKeys: Key[];
  keyToRowId: Map<string, string>;
  rowById: Map<string, PackageRow>;
  rowIdToKey: Map<string, string>;
  treeData: PackageTreeItem[];
  treeInstanceKey: string;
};

function collectTreeState(treeData: PackageTreeItem[], rows: PackageRow[]): PackageContentTreeState {
  const expandedKeys: Key[] = [];
  const keyToRowId = new Map<string, string>();
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const rowIdToKey = new Map<string, string>();

  const visit = (nodes: PackageTreeItem[]) => {
    nodes.forEach((node) => {
      if (node.children && node.children.length > 0) {
        expandedKeys.push(node.key);
        visit(node.children);
      }

      if (node.packageRowId) {
        keyToRowId.set(node.key, node.packageRowId);
        rowIdToKey.set(node.packageRowId, node.key);
      }
    });
  };

  visit(treeData);

  return {
    expandedKeys,
    keyToRowId,
    rowById,
    rowIdToKey,
    treeData,
    treeInstanceKey: [
      treeData.map((node) => node.key).join('|'),
      expandedKeys.join('|'),
      Array.from(keyToRowId.keys()).join('|'),
    ].join('::'),
  };
}

export function PackageContentTree({ rows, height, selectedPackageId, onSelectPackage }: PackageContentTreeProps) {
  const treeState = useMemo(() => collectTreeState(buildPackageTree(rows), rows), [rows]);
  const [expandedState, setExpandedState] = useState<{ instanceKey: string; keys: Key[] } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const expandedKeys = expandedState?.instanceKey === treeState.treeInstanceKey
    ? expandedState.keys
    : treeState.expandedKeys;
  const visibleRows = useMemo(() => (
    flattenVisibleTreeRows(treeState.treeData, expandedKeys)
  ), [expandedKeys, treeState.treeData]);
  const parentTrail = visibleTreeParentTrail(visibleRows, scrollTop);
  const treeHeight = Math.max(0, height - visibleTreeParentTrailHeight(parentTrail));
  const selectedTreeKey = selectedPackageId ? treeState.rowIdToKey.get(selectedPackageId) : undefined;
  const selectedKeys = selectedTreeKey ? [selectedTreeKey] : [];

  useEffect(() => {
    setScrollTop(0);
    setExpandedState(null);
  }, [treeState.treeInstanceKey]);

  const handleSelect = useCallback((keys: Key[]) => {
    const key = String(keys[0] || '');
    const rowId = treeState.keyToRowId.get(key);
    const row = rowId ? treeState.rowById.get(rowId) : undefined;

    if (row) {
      onSelectPackage(row);
    }
  }, [onSelectPackage, treeState]);
  const handleExpand = useCallback((keys: Key[]) => {
    setExpandedState({ instanceKey: treeState.treeInstanceKey, keys });
  }, [treeState.treeInstanceKey]);
  const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No packages to show." />;
  }

  return (
    <div className="visible-tree-with-parent-trail" style={{ height }}>
      <VisibleTreeParentTrail trail={parentTrail} />
      <Tree
        key={treeState.treeInstanceKey}
        blockNode
        defaultExpandAll
        defaultExpandedKeys={treeState.expandedKeys}
        expandedKeys={expandedKeys}
        height={treeHeight}
        selectedKeys={selectedKeys}
        treeData={treeState.treeData}
        virtual
        onExpand={handleExpand}
        onScroll={handleScroll}
        onSelect={handleSelect}
      />
    </div>
  );
}
