import { describe, expect, test } from 'vitest';
import { toAntTreeData, supportedFileKeys } from './packageTreeData';
import type { PackageTreeNode } from '../types/upi';

const scanTree: PackageTreeNode = {
  name: 'Paks',
  path: 'C:\\Paks',
  kind: 'directory',
  children: [
    { name: 'A.pak', path: 'C:\\Paks\\A.pak', kind: 'pak', relativePath: 'A.pak' },
    {
      name: 'Nested',
      path: 'C:\\Paks\\Nested',
      kind: 'directory',
      children: [
        {
          name: 'global.utoc',
          path: 'C:\\Paks\\Nested\\global.utoc',
          kind: 'utoc',
          relativePath: 'Nested\\global.utoc',
        },
      ],
    },
  ],
};

describe('packageTreeData', () => {
  test('maps scan tree nodes to Ant Design tree data with stable keys', () => {
    expect(toAntTreeData(scanTree)).toEqual([
      {
        key: 'C:\\Paks',
        title: 'Paks',
        selectable: false,
        children: [
          { key: 'C:\\Paks\\A.pak', title: 'A.pak', selectable: true, children: undefined },
          {
            key: 'C:\\Paks\\Nested',
            title: 'Nested',
            selectable: false,
            children: [
              { key: 'C:\\Paks\\Nested\\global.utoc', title: 'global.utoc', selectable: true, children: undefined },
            ],
          },
        ],
      },
    ]);
  });

  test('collects only supported file keys', () => {
    expect(supportedFileKeys(scanTree)).toEqual(['C:\\Paks\\A.pak', 'C:\\Paks\\Nested\\global.utoc']);
  });

  test('keeps supported relative path only nodes selectable', () => {
    const looseNode: PackageTreeNode = {
      name: 'A.pak',
      kind: 'pak',
      relativePath: 'Loose/A.pak',
    };

    expect(toAntTreeData(looseNode)).toEqual([
      {
        key: 'Loose/A.pak',
        title: 'A.pak',
        selectable: true,
        children: undefined,
      },
    ]);
    expect(supportedFileKeys(looseNode)).toEqual(['Loose/A.pak']);
  });
});
