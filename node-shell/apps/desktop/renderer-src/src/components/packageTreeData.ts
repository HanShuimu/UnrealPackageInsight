import type { DataNode } from 'antd/es/tree';
import type { PackageTreeNode } from '../types/upi';

const SUPPORTED_FILE_KINDS = new Set(['pak', 'utoc', 'ucas']);

export function isSupportedFileNode(node: PackageTreeNode): boolean {
  return Boolean(node.kind && SUPPORTED_FILE_KINDS.has(node.kind) && nodeKey(node));
}

export function nodeKey(node: PackageTreeNode): string {
  return node.path || node.relativePath || node.name || 'unnamed';
}

export function toAntTreeData(node: PackageTreeNode): DataNode[] {
  const children = node.children?.flatMap((child) => toAntTreeData(child));

  return [
    {
      key: nodeKey(node),
      title: node.name || node.path || '',
      selectable: isSupportedFileNode(node),
      children: children?.length ? children : undefined,
    },
  ];
}

export function supportedFileKeys(node: PackageTreeNode): string[] {
  const ownKeys = isSupportedFileNode(node) ? [nodeKey(node)] : [];
  const childKeys = node.children?.flatMap((child) => supportedFileKeys(child)) || [];

  return [...ownKeys, ...childKeys];
}
