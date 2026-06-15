const fs = require('node:fs/promises');
const path = require('node:path');

const { getContainerKind } = require('./container-pairing.js');

function compareNames(left, right) {
  const normalizedLeft = left.name.toLowerCase();
  const normalizedRight = right.name.toLowerCase();
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  if (left.name < right.name) {
    return -1;
  }
  if (left.name > right.name) {
    return 1;
  }
  return 0;
}

function compareChildren(left, right) {
  const leftIsDirectory = left.kind === 'directory';
  const rightIsDirectory = right.kind === 'directory';
  if (leftIsDirectory !== rightIsDirectory) {
    return leftIsDirectory ? -1 : 1;
  }
  return compareNames(left, right);
}

function toWindowsRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join(path.win32.sep);
}

function createFileRecord(root, filePath, name, kind) {
  const extension = path.extname(name).toLowerCase();
  return {
    path: filePath,
    name,
    extension,
    kind,
    relativePath: toWindowsRelativePath(root, filePath),
  };
}

async function scanDirectory(root, dirPath, files) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries.sort(compareNames)) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const directoryNode = await scanDirectory(root, entryPath, files);
      if (directoryNode.children.length > 0) {
        children.push(directoryNode);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const kind = getContainerKind(entry.name);
    if (kind === 'unsupported') {
      continue;
    }

    const file = createFileRecord(root, entryPath, entry.name, kind);
    files.push(file);
    children.push({
      name: file.name,
      path: file.path,
      kind: file.kind,
      relativePath: file.relativePath,
    });
  }

  children.sort(compareChildren);
  return {
    name: path.basename(dirPath),
    path: dirPath,
    kind: 'directory',
    children,
  };
}

async function scanPackageDirectory(root) {
  const files = [];
  const tree = await scanDirectory(root, root, files);
  files.sort((left, right) => compareNames(
    { name: left.relativePath },
    { name: right.relativePath },
  ));

  return {
    root,
    files,
    tree,
  };
}

module.exports = {
  scanPackageDirectory,
};
