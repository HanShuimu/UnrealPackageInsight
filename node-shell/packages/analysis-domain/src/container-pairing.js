const path = require('node:path');

const IO_STORE_PAIR_MISSING_ISSUE = {
  severity: 'error',
  code: 'iostore.pair_missing',
  message: 'Selected IoStore file is missing its matching .utoc or .ucas file.',
};

function comparePaths(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function getContainerKind(filePath) {
  switch (path.win32.extname(filePath).toLowerCase()) {
    case '.pak':
      return 'pak';
    case '.utoc':
      return 'utoc';
    case '.ucas':
      return 'ucas';
    default:
      return 'unsupported';
  }
}

function stripIoStorePartitionSuffix(baseName) {
  return baseName.replace(/_s\d+$/i, '');
}

function createPairKey(dir, baseName) {
  return `${path.win32.normalize(dir).toLowerCase()}|${baseName.toLowerCase()}`;
}

function getPairKey(filePath, kind) {
  const dir = path.win32.dirname(filePath);
  const extension = path.win32.extname(filePath);
  const rawBaseName = path.win32.basename(filePath, extension);
  const baseName = kind === 'ucas' ? stripIoStorePartitionSuffix(rawBaseName) : rawBaseName;
  return createPairKey(dir, baseName);
}

function getOrCreatePair(pairs, key) {
  const existing = pairs.get(key);
  if (existing) {
    return existing;
  }

  const pair = { utocPath: '', ucasPaths: [] };
  pairs.set(key, pair);
  return pair;
}

function buildIoStorePairs(filePaths) {
  const pairs = new Map();
  const sortedPaths = [...filePaths].sort(comparePaths);

  for (const filePath of sortedPaths) {
    const kind = getContainerKind(filePath);
    if (kind !== 'utoc' && kind !== 'ucas') {
      continue;
    }

    const pair = getOrCreatePair(pairs, getPairKey(filePath, kind));
    if (kind === 'utoc') {
      if (pair.utocPath === '') {
        pair.utocPath = filePath;
      }
    } else {
      pair.ucasPaths.push(filePath);
    }
  }

  for (const pair of pairs.values()) {
    pair.ucasPaths.sort(comparePaths);
  }

  return pairs;
}

function resolveIoStoreSelection(filePath, filePaths) {
  const kind = getContainerKind(filePath);
  if (kind !== 'utoc' && kind !== 'ucas') {
    return null;
  }

  const pairs = buildIoStorePairs(filePaths);
  const pair = pairs.get(getPairKey(filePath, kind));
  if (!pair || pair.utocPath === '' || pair.ucasPaths.length === 0) {
    return {
      ok: false,
      issue: { ...IO_STORE_PAIR_MISSING_ISSUE },
    };
  }

  return {
    ok: true,
    utocPath: pair.utocPath,
    ucasPath: pair.ucasPaths[0],
    ucasPaths: [...pair.ucasPaths],
  };
}

module.exports = {
  buildIoStorePairs,
  getContainerKind,
  resolveIoStoreSelection,
  stripIoStorePartitionSuffix,
};
