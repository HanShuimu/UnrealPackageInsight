import { Empty, Tree } from 'antd';
import type { Key } from 'react';
import type { PackageScan } from '../types/upi';
import { supportedFileKeys, toAntTreeData } from './packageTreeData';

type PackageTreeProps = {
  scan: PackageScan | null;
  selectedFilePath: string;
  height: number;
  onSelectFile(filePath: string): void;
};

export function PackageTree({ scan, selectedFilePath, height, onSelectFile }: PackageTreeProps) {
  if (!scan?.tree || scan.files.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No supported package files found." />;
  }

  const selectableKeys = new Set(supportedFileKeys(scan.tree));
  const treeData = toAntTreeData(scan.tree);

  const handleSelect = (keys: Key[]) => {
    const key = String(keys[0] || '');
    if (selectableKeys.has(key)) {
      onSelectFile(key);
    }
  };

  return (
    <Tree
      blockNode
      defaultExpandAll
      height={height}
      selectedKeys={selectedFilePath ? [selectedFilePath] : []}
      treeData={treeData}
      virtual
      onSelect={handleSelect}
    />
  );
}
