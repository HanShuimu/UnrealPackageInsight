import { describe, expect, test } from 'vitest';
import type { PackageTreeNode } from '../types/upi';
import {
  OPENED_CONTAINERS_DEFAULT_WIDTH,
  clampOpenedContainersWidth,
  estimateOpenedContainersWidth,
} from './openedContainersPane';

const deepTree: PackageTreeNode = {
  name: 'Windows',
  path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows',
  kind: 'directory',
  children: [
    {
      name: 'Project',
      kind: 'directory',
      children: [
        {
          name: 'Content',
          kind: 'directory',
          children: [
            {
              name: 'Paks',
              kind: 'directory',
              children: [
                {
                  name: 'pakchunk0-WindowsNoEditor_Optional_StreamedTextures_VeryLongLabel.pak',
                  path: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\Project\\Content\\Paks\\pakchunk0-WindowsNoEditor_Optional_StreamedTextures_VeryLongLabel.pak',
                  kind: 'pak',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('openedContainersPane', () => {
  test('estimates wider than default for a deep supported package tree', () => {
    expect(estimateOpenedContainersWidth(deepTree, 1440)).toBeGreaterThan(
      OPENED_CONTAINERS_DEFAULT_WIDTH,
    );
  });

  test('clamps opened containers width to minimum and viewport maximum', () => {
    expect(clampOpenedContainersWidth(120, 1440)).toBe(236);
    expect(clampOpenedContainersWidth(900, 1440)).toBe(576);
  });
});
