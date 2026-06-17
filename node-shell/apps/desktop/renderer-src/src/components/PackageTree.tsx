import { Empty, Tree } from 'antd';
import type { Key } from 'react';
import { useCallback, useMemo } from 'react';
import type { PackageScan } from '../types/upi';
import { createSelectableFileMap, directoryKeys, toAntTreeData } from './packageTreeData';

type PackageTreeProps = {
  scan: PackageScan | null;
  selectedFilePath: string;
  height: number;
  onSelectFile(filePath: string): void;
};

export function PackageTree({ scan, selectedFilePath, height, onSelectFile }: PackageTreeProps) {
  const treeState = useMemo(() => {
    if (!scan?.tree) {
      return null;
    }

    const treeData = toAntTreeData(scan.tree);
    const selectableFiles = createSelectableFileMap(scan.tree);
    const expandedKeys = directoryKeys(scan.tree);
    const treeInstanceKey = [
      String(treeData[0]?.key || ''),
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
