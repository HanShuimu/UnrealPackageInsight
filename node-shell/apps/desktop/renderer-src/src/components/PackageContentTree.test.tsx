import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { PackageRow, PackageTreeItem } from '../utils/analysisViewModel';
import { PackageContentTree } from './PackageContentTree';

type MockTreeProps = {
  blockNode?: boolean;
  defaultExpandAll?: boolean;
  defaultExpandedKeys?: React.Key[];
  expandedKeys?: React.Key[];
  height?: number;
  onExpand?: (keys: React.Key[]) => void;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  selectedKeys?: React.Key[];
  treeData?: PackageTreeItem[];
  virtual?: boolean;
  onSelect?: (keys: React.Key[]) => void;
};

const treeHarness = vi.hoisted(() => ({
  props: [] as MockTreeProps[],
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div data-testid="mock-empty">{description}</div>,
    Tree: (props: MockTreeProps) => {
      treeHarness.props.push(props);

      const renderNode = (node: PackageTreeItem): React.ReactNode => (
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
          data-block-node={String(props.blockNode)}
          data-default-expand-all={String(props.defaultExpandAll)}
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

const row: PackageRow = {
  id: 'base',
  fullPath: '../../../Engine/Config/Base.ini',
  fileName: 'Base.ini',
  type: 'ini',
  size: 1300,
  compressedSize: 900,
  physicalOrder: 1,
  source: {},
};

function latestTreeProps(): MockTreeProps {
  const props = treeHarness.props.at(-1);
  expect(props).toBeDefined();
  return props as MockTreeProps;
}

describe('PackageContentTree', () => {
  beforeEach(() => {
    treeHarness.props = [];
  });

  test('builds a package-content hierarchy from package paths', () => {
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="" onSelectPackage={() => {}} />);

    expect(latestTreeProps().treeData).toEqual([
      {
        key: '../../../Engine',
        title: 'Engine',
        selectable: false,
        children: [
          {
            key: '../../../Engine/Config',
            title: 'Config',
            selectable: false,
            children: [
              {
                key: '../../../Engine/Config/Base.ini',
                title: 'Base.ini',
                packageRowId: 'base',
                selectable: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  test('passes required Ant Design tree virtualization props', () => {
    render(<PackageContentTree rows={[row]} height={480} selectedPackageId="" onSelectPackage={() => {}} />);

    const tree = screen.getByTestId('mock-tree');
    expect(tree).toHaveAttribute('data-block-node', 'true');
    expect(tree).toHaveAttribute('data-default-expand-all', 'true');
    expect(tree).toHaveAttribute('data-height', '442');
    expect(tree).toHaveAttribute('data-virtual', 'true');
  });

  test('expands directory keys without including leaf-only package keys', () => {
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="" onSelectPackage={() => {}} />);

    expect(latestTreeProps().defaultExpandedKeys).toEqual(['../../../Engine', '../../../Engine/Config']);
  });

  test('selecting a package leaf calls onSelectPackage with the matching row', () => {
    const onSelectPackage = vi.fn();
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="" onSelectPackage={onSelectPackage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Base.ini' }));

    expect(onSelectPackage).toHaveBeenCalledWith(row);
  });

  test('selecting directories or unknown keys does not call onSelectPackage', () => {
    const onSelectPackage = vi.fn();
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="" onSelectPackage={onSelectPackage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Config' }));
    latestTreeProps().onSelect?.(['missing-key']);

    expect(onSelectPackage).not.toHaveBeenCalled();
  });

  test('maps selected package row IDs back to leaf tree keys', () => {
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="base" onSelectPackage={() => {}} />);

    expect(latestTreeProps().selectedKeys).toEqual(['../../../Engine/Config/Base.ini']);
  });

  test('keeps the current visible package parent chain pinned while the tree scrolls', () => {
    render(<PackageContentTree rows={[row]} height={360} selectedPackageId="" onSelectPackage={() => {}} />);

    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Engine');

    fireEvent.scroll(screen.getByTestId('mock-tree'), { target: { scrollTop: 60 } });

    expect(screen.getByTestId('mock-tree')).toHaveAttribute('data-height', '292');
    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Engine');
    expect(screen.getByLabelText('Current visible parents')).toHaveTextContent('Config');
  });

  test('selects and highlights duplicate package path leaves by their distinct tree keys', () => {
    const duplicateRows: PackageRow[] = [
      {
        ...row,
        id: 'foo-primary',
        fullPath: '../../../Game/Foo.uasset',
        fileName: 'Foo.uasset',
      },
      {
        ...row,
        id: 'foo-secondary',
        fullPath: '../../../Game/Foo.uasset',
        fileName: 'Foo.uasset',
      },
    ];
    const onSelectPackage = vi.fn();

    render(
      <PackageContentTree
        rows={duplicateRows}
        height={360}
        selectedPackageId="foo-secondary"
        onSelectPackage={onSelectPackage}
      />,
    );

    const duplicateLeafKeys = latestTreeProps()
      .treeData?.[0]
      ?.children?.map((leaf) => leaf.key);

    expect(duplicateLeafKeys).toEqual([
      '../../../Game/Foo.uasset::foo-primary',
      '../../../Game/Foo.uasset::foo-secondary',
    ]);
    expect(latestTreeProps().selectedKeys).toEqual(['../../../Game/Foo.uasset::foo-secondary']);

    latestTreeProps().onSelect?.(['../../../Game/Foo.uasset::foo-primary']);
    latestTreeProps().onSelect?.(['../../../Game/Foo.uasset::foo-secondary']);

    expect(onSelectPackage).toHaveBeenNthCalledWith(1, duplicateRows[0]);
    expect(onSelectPackage).toHaveBeenNthCalledWith(2, duplicateRows[1]);
  });

  test('shows an empty package message when there are no rows', () => {
    render(<PackageContentTree rows={[]} height={360} selectedPackageId="" onSelectPackage={() => {}} />);

    expect(screen.getByTestId('mock-empty')).toHaveTextContent('No packages to show.');
    expect(screen.queryByTestId('mock-tree')).not.toBeInTheDocument();
  });
});
