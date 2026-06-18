import type { DataNode } from 'antd/es/tree';
import type { PackageTreeNode } from '../types/upi';

const SUPPORTED_FILE_KINDS = new Set(['pak', 'utoc', 'ucas']);

function fileValue(node: PackageTreeNode): string {
  return node.path || node.relativePath || '';
}

function isDirectoryNode(node: PackageTreeNode): boolean {
  return node.kind === 'directory' || Boolean(node.children?.length);
}

export function isSupportedFileNode(node: PackageTreeNode): boolean {
  return Boolean(node.kind && SUPPORTED_FILE_KINDS.has(node.kind) && fileValue(node));
}

export function nodeKey(node: PackageTreeNode, parentKey = '', index = 0): string {
  const key = fileValue(node);
  if (key) {
    return key;
  }

  const fallback = `${node.name || 'node'}#${index}`;
  return parentKey ? `${parentKey}/${fallback}` : fallback;
}

function toAntTreeNode(node: PackageTreeNode, parentKey: string, index: number): DataNode {
  const key = nodeKey(node, parentKey, index);
  const children = node.children?.map((child, childIndex) => toAntTreeNode(child, key, childIndex));

  return {
    key,
    title: node.name || node.path || node.relativePath || '',
    selectable: isSupportedFileNode(node),
    children: children?.length ? children : undefined,
  };
}

export function toAntTreeData(node: PackageTreeNode): DataNode[] {
  return [toAntTreeNode(node, '', 0)];
}

export function createSelectableFileMap(node: PackageTreeNode): Map<string, string> {
  const selectableFiles = new Map<string, string>();

  const visit = (current: PackageTreeNode, parentKey: string, index: number) => {
    const key = nodeKey(current, parentKey, index);
    const value = fileValue(current);
    if (isSupportedFileNode(current) && value) {
      selectableFiles.set(key, value);
    }

    current.children?.forEach((child, childIndex) => visit(child, key, childIndex));
  };

  visit(node, '', 0);

  return selectableFiles;
}

export function directoryKeys(node: PackageTreeNode): string[] {
  const keys: string[] = [];

  const visit = (current: PackageTreeNode, parentKey: string, index: number) => {
    const key = nodeKey(current, parentKey, index);
    if (isDirectoryNode(current)) {
      keys.push(key);
    }

    current.children?.forEach((child, childIndex) => visit(child, key, childIndex));
  };

  visit(node, '', 0);

  return keys;
}

export function supportedFileKeys(node: PackageTreeNode): string[] {
  return Array.from(createSelectableFileMap(node).values());
}
