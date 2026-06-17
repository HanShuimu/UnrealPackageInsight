import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PackageScan } from '../types/upi';
import { PackageTree } from './PackageTree';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Tree: (props: {
      height?: number;
      virtual?: boolean;
      treeData?: Array<{ key: string; title: string }>;
      onSelect?: (keys: React.Key[]) => void;
    }) => (
      <div data-testid="mock-tree" data-height={props.height} data-virtual={String(props.virtual !== false)}>
        {props.treeData?.map((node) => (
          <button key={node.key} type="button" onClick={() => props.onSelect?.([node.key])}>
            {node.title}
          </button>
        ))}
      </div>
    ),
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

describe('PackageTree', () => {
  test('passes a numeric height to keep Ant Design virtual scrolling active', () => {
    render(<PackageTree scan={scan} selectedFilePath="" height={512} onSelectFile={() => {}} />);

    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-height', '512');
    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-virtual', 'true');
  });
});
