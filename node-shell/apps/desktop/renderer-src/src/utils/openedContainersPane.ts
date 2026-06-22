import type { PackageTreeNode } from '../types/upi';

export const OPENED_CONTAINERS_DEFAULT_WIDTH = 304;
export const OPENED_CONTAINERS_MIN_WIDTH = 236;
export const OPENED_CONTAINERS_MAX_FRACTION = 0.4;
export const OPENED_CONTAINERS_MAX_WIDTH = 640;

const SUPPORTED_FILE_KINDS = new Set(['pak', 'utoc', 'ucas']);
const LABEL_PIXEL_WIDTH = 7;
const DEPTH_INDENT_WIDTH = 20;
const TREE_PADDING_WIDTH = 96;

function fileValue(node: PackageTreeNode): string {
  return node.path || node.relativePath || '';
}

function isSupportedFileNode(node: PackageTreeNode): boolean {
  return Boolean(node.kind && SUPPORTED_FILE_KINDS.has(node.kind) && fileValue(node));
}

function supportedFileMeasureLength(node: PackageTreeNode): number {
  return Math.max(
    node.name?.length ?? 0,
    node.relativePath?.length ?? 0,
    node.path?.length ?? 0,
  );
}

export function clampOpenedContainersWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.floor(viewportWidth * OPENED_CONTAINERS_MAX_FRACTION);
  const maxWidth = Math.max(
    OPENED_CONTAINERS_MIN_WIDTH,
    Math.min(OPENED_CONTAINERS_MAX_WIDTH, viewportMax),
  );
  const finiteWidth = Number.isFinite(width) ? width : OPENED_CONTAINERS_DEFAULT_WIDTH;

  return Math.min(
    maxWidth,
    Math.max(OPENED_CONTAINERS_MIN_WIDTH, Math.round(finiteWidth)),
  );
}

export function estimateOpenedContainersWidth(
  tree: PackageTreeNode | null | undefined,
  viewportWidth: number,
): number {
  let deepestSupportedDepth = 0;
  let longestSupportedLabel = 0;

  const visit = (node: PackageTreeNode, depth: number) => {
    if (isSupportedFileNode(node)) {
      deepestSupportedDepth = Math.max(deepestSupportedDepth, depth);
      longestSupportedLabel = Math.max(longestSupportedLabel, supportedFileMeasureLength(node));
    }

    node.children?.forEach((child) => visit(child, depth + 1));
  };

  if (tree) {
    visit(tree, 0);
  }

  const estimatedWidth = longestSupportedLabel > 0
    ? TREE_PADDING_WIDTH + deepestSupportedDepth * DEPTH_INDENT_WIDTH
      + longestSupportedLabel * LABEL_PIXEL_WIDTH
    : OPENED_CONTAINERS_DEFAULT_WIDTH;

  return clampOpenedContainersWidth(
    Math.max(OPENED_CONTAINERS_DEFAULT_WIDTH, estimatedWidth),
    viewportWidth,
  );
}
