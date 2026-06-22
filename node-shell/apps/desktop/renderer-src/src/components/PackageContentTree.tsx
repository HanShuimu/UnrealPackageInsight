import { Empty, Tree } from 'antd';
import type { Key } from 'react';
import { useCallback, useMemo } from 'react';
import { buildPackageTree, type PackageRow, type PackageTreeItem } from '../utils/analysisViewModel';

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
  const selectedTreeKey = selectedPackageId ? treeState.rowIdToKey.get(selectedPackageId) : undefined;
  const selectedKeys = selectedTreeKey ? [selectedTreeKey] : [];

  const handleSelect = useCallback((keys: Key[]) => {
    const key = String(keys[0] || '');
    const rowId = treeState.keyToRowId.get(key);
    const row = rowId ? treeState.rowById.get(rowId) : undefined;

    if (row) {
      onSelectPackage(row);
    }
  }, [onSelectPackage, treeState]);

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No packages to show." />;
  }

  return (
    <Tree
      key={treeState.treeInstanceKey}
      blockNode
      defaultExpandAll
      defaultExpandedKeys={treeState.expandedKeys}
      height={height}
      selectedKeys={selectedKeys}
      treeData={treeState.treeData}
      virtual
      onSelect={handleSelect}
    />
  );
}
