import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PackageScan } from '../types/upi';
import { PackageTree } from './PackageTree';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  type MockTreeNode = {
    key: React.Key;
    title?: React.ReactNode;
    children?: MockTreeNode[];
  };

  return {
    ...actual,
    Tree: (props: {
      defaultExpandedKeys?: React.Key[];
      expandedKeys?: React.Key[];
      height?: number;
      onExpand?: (keys: React.Key[]) => void;
      onScroll?: React.UIEventHandler<HTMLDivElement>;
      virtual?: boolean;
      treeData?: MockTreeNode[];
      onSelect?: (keys: React.Key[]) => void;
    }) => {
      const renderNode = (node: MockTreeNode): React.ReactNode => (
        <div key={node.key}>
          <button type="button" onClick={() => props.onSelect?.([node.key])}>
            {node.title}
          </button>
          {node.children?.map(renderNode)}
        </div>
      );

      return (
        <div
          data-testid="mock-tree"
          data-default-expanded={props.defaultExpandedKeys?.join('|') || ''}
          data-expanded={props.expandedKeys?.join('|') || ''}
          data-height={props.height}
          data-virtual={String(props.virtual)}
          onScroll={props.onScroll}
        >
          {props.treeData?.map(renderNode)}
        </div>
      );
    },
  };
});

const scan: PackageScan = {
  root: 'C:\\Paks',
  files: [{ path: 'C:\\Paks\\A.pak', name: 'A.pak' }],
  tree: {
    name: 'Paks',
    path: 'C:\\Paks',
    kind: 'directory',
    children: [{ name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak' }],
  },
};

const nestedScan: PackageScan = {
  root: 'C:\\Paks',
  files: [
    { path: 'C:\\Paks\\A.pak', name: 'A.pak' },
    { path: 'Nested/global.utoc', name: 'global.utoc' },
  ],
  tree: {
    name: 'Paks',
    path: 'C:\\Paks',
    kind: 'directory',
    children: [
      { name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak' },
      {
        name: 'Nested',
        path: 'C:\\Paks\\Nested',
        kind: 'directory',
        children: [{ name: 'global.utoc', kind: 'utoc', relativePath: 'Nested/global.utoc' }],
      },
    ],
  },
};

describe('PackageTree', () => {
  test('passes a numeric height to keep Ant Design virtual scrolling active', () => {
    render(<PackageTree scan={scan} selectedFilePath="" height={512} onSelectFile={() => {}} />);

    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-height', '474');
    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-virtual', 'true');
  });

  test('passes directory keys so nested folders expand when the scan changes', () => {
    render(<PackageTree scan={nestedScan} selectedFilePath="" height={512} onSelectFile={() => {}} />);

    expect(screen.getByTestId('mock-tree')).toHaveAttribute(
      'data-default-expanded',
      'C:\\Paks|C:\\Paks\\Nested',
    );
    expect(screen.getByTestId('mock-tree')).toHaveAttribute(
      'data-expanded',
      'C:\\Paks|C:\\Paks\\Nested',
    );
  });

  test('does not select directories', () => {
    const onSelectFile = vi.fn();

    render(<PackageTree scan={nestedScan} selectedFilePath="" height={512} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByRole('button', { name: 'Nested' }));

    expect(onSelectFile).not.toHaveBeenCalled();
  });

  test('selects nested supported files with their path-like value', () => {
    const onSelectFile = vi.fn();

    render(<PackageTree scan={nestedScan} selectedFilePath="" height={512} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByRole('button', { name: 'global.utoc' }));

    expect(onSelectFile).toHaveBeenCalledWith('Nested/global.utoc');
  });

  test('keeps the current visible parent chain pinned while the tree scrolls', () => {
    render(<PackageTree scan={nestedScan} selectedFilePath="" height={512} onSelectFile={() => {}} />);

    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Paks');

    fireEvent.scroll(screen.getByTestId('mock-tree'), { target: { scrollTop: 90 } });

    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Paks');
    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Nested');
  });
});
