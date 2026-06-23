import { Empty, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { Key, ReactNode, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PackageScan } from '../types/upi';
import { VisibleTreeParentTrail } from './VisibleTreeParentTrail';
import {
  createSelectableFileMap,
  directoryKeys,
  toAntTreeData,
  type PackageTreeDataNode,
} from './packageTreeData';
import {
  VISIBLE_TREE_PARENT_TRAIL_HEIGHT,
  flattenVisibleTreeRows,
  visibleTreeParentTrail,
} from './visibleTreeParents';

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

    return { expandedKeys, rawTreeData, selectableFiles, treeData, treeInstanceKey };
  }, [scan?.tree]);
  const [expandedState, setExpandedState] = useState<{ instanceKey: string; keys: Key[] } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const hasExpandedState = expandedState !== null && expandedState.instanceKey === treeState?.treeInstanceKey;
  const expandedKeys = hasExpandedState
    ? expandedState.keys
    : treeState?.expandedKeys ?? [];
  const visibleRows = useMemo(() => (
    flattenVisibleTreeRows(treeState?.rawTreeData ?? [], expandedKeys)
  ), [expandedKeys, treeState?.rawTreeData]);
  const parentTrail = visibleTreeParentTrail(visibleRows, scrollTop);
  const treeHeight = Math.max(0, height - VISIBLE_TREE_PARENT_TRAIL_HEIGHT);

  useEffect(() => {
    setScrollTop(0);
    setExpandedState(null);
  }, [treeState?.treeInstanceKey]);

  const handleSelect = useCallback((keys: Key[]) => {
    const key = String(keys[0] || '');
    const filePath = treeState?.selectableFiles.get(key);
    if (filePath) {
      onSelectFile(filePath);
    }
  }, [onSelectFile, treeState]);
  const handleExpand = useCallback((keys: Key[]) => {
    if (treeState) {
      setExpandedState({ instanceKey: treeState.treeInstanceKey, keys });
    }
  }, [treeState]);
  const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  if (!scan?.tree || scan.files.length === 0 || !treeState) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No supported package files found." />;
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
        selectedKeys={selectedFilePath ? [selectedFilePath] : []}
        treeData={treeState.treeData}
        virtual
        onExpand={handleExpand}
        onScroll={handleScroll}
        onSelect={handleSelect}
      />
    </div>
  );
}
