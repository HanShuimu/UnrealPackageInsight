import { Empty, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { Key, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import type { PackageScan } from '../types/upi';
import {
  createSelectableFileMap,
  directoryKeys,
  toAntTreeData,
  type PackageTreeDataNode,
} from './packageTreeData';

type PackageTreeProps = {
  scan: PackageScan | null;
  selectedFilePath: string;
  height: number;
  onSelectFile(filePath: string): void;
};

function openedContainerTitle(node: PackageTreeDataNode): ReactNode {
  const title = node.title || String(node.key);

  return (
    <span className="opened-container-tree-title" title={node.fullPath || title}>
      {title}
    </span>
  );
}

function withOpenedContainerTitles(nodes: PackageTreeDataNode[]): DataNode[] {
  return nodes.map(({ children, fullPath: _fullPath, title: _title, ...node }) => ({
    ...node,
    title: openedContainerTitle({ ...node, children, fullPath: _fullPath, title: _title }),
    children: children?.length ? withOpenedContainerTitles(children) : undefined,
  }));
}

export function PackageTree({ scan, selectedFilePath, height, onSelectFile }: PackageTreeProps) {
  const treeState = useMemo(() => {
    if (!scan?.tree) {
      return null;
    }

    const rawTreeData = toAntTreeData(scan.tree);
    const treeData = withOpenedContainerTitles(rawTreeData);
    const selectableFiles = createSelectableFileMap(scan.tree);
    const expandedKeys = directoryKeys(scan.tree);
    const treeInstanceKey = [
      String(rawTreeData[0]?.key || ''),
      expandedKeys.join('|'),
      Array.from(selectableFiles.keys()).join('|'),
    ].join('::');

    return { expandedKeys, selectableFiles, treeData, treeInstanceKey };
  }, [scan?.tree]);

  const handleSelect = useCallback((keys: Key[]) => {
    const key = String(keys[0] || '');
    const filePath = treeState?.selectableFiles.get(key);
    if (filePath) {
      onSelectFile(filePath);
    }
  }, [onSelectFile, treeState]);

  if (!scan?.tree || scan.files.length === 0 || !treeState) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No supported package files found." />;
  }

  return (
    <Tree
      key={treeState.treeInstanceKey}
      blockNode
      defaultExpandAll
      defaultExpandedKeys={treeState.expandedKeys}
      height={height}
      selectedKeys={selectedFilePath ? [selectedFilePath] : []}
      treeData={treeState.treeData}
      virtual
      onSelect={handleSelect}
    />
  );
}
