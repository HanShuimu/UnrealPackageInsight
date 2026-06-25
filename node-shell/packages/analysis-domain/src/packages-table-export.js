function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const trimmedValue = value.trim();
    if (!/^[+-]?\d+$/.test(trimmedValue)) {
      return undefined;
    }
    const numberValue = Number(BigInt(trimmedValue));
    return Number.isSafeInteger(numberValue) ? numberValue : undefined;
  }
  return undefined;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const numberValue = toFiniteNumber(value);
    if (numberValue !== undefined) {
      return numberValue;
    }
  }
  return undefined;
}

function firstPathValue(record) {
  const values = [
    record.packagePath,
    record.package_path,
    record.path,
    record.fullPath,
    record.full_path,
    record.relativePath,
    record.relative_path,
    record.name,
  ];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmedValue = value.trim();
    if (trimmedValue !== '') {
      return trimmedValue;
    }
  }
  return undefined;
}

function pathSegments(filePath) {
  return filePath.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}

function fileNameFromPath(filePath) {
  const segments = pathSegments(filePath);
  return segments[segments.length - 1] || filePath;
}

function typeFromFileName(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'en', { numeric: true, sensitivity: 'base' });
}

function comparePackagePath(left, right) {
  return (
    compareText(left.fileName, right.fileName)
    || compareText(left.fullPath, right.fullPath)
    || compareText(left.id || '', right.id || '')
  );
}

function comparePackageFileName(left, right) {
  return comparePackagePath(left, right);
}

function compareNumericField(field) {
  return (left, right, order = 'ascend') => {
    const leftValue = left[field];
    const rightValue = right[field];
    const leftHasValue = leftValue !== undefined && Number.isFinite(leftValue);
    const rightHasValue = rightValue !== undefined && Number.isFinite(rightValue);
    const direction = order === 'descend' ? -1 : 1;

    if (leftHasValue && rightHasValue && leftValue !== rightValue) {
      return (leftValue - rightValue) * direction;
    }
    if (leftHasValue !== rightHasValue) {
      return leftHasValue ? -1 : 1;
    }
    return comparePackageFileName(left, right) * direction;
  };
}

function comparePackageOrder(left, right) {
  return compareNumericField('physicalOrder')(left, right);
}

function allocatePackageId(row, duplicateCounts, usedIds, reservedIds) {
  const duplicateCount = (duplicateCounts.get(row.fullPath) || 0) + 1;
  duplicateCounts.set(row.fullPath, duplicateCount);

  if (duplicateCount === 1 && !usedIds.has(row.fullPath)) {
    usedIds.add(row.fullPath);
    return row.fullPath;
  }

  let suffix = duplicateCount;
  let candidate = `${row.fullPath}#${suffix}`;
  while (usedIds.has(candidate) || reservedIds.has(candidate)) {
    suffix += 1;
    candidate = `${row.fullPath}#${suffix}`;
  }
  usedIds.add(candidate);
  return candidate;
}

const PACKAGE_TABLE_COLUMNS = Object.freeze([
  Object.freeze({
    key: 'fullPath',
    dataIndex: 'fullPath',
    title: 'Full Path',
    width: 520,
    fixed: 'left',
    className: 'package-path-column',
    exportValue: (row) => row.fullPath,
  }),
  Object.freeze({
    key: 'size',
    dataIndex: 'size',
    title: 'Size',
    width: 120,
    compare: compareNumericField('size'),
    exportValue: (row) => row.size,
  }),
  Object.freeze({
    key: 'compressedSize',
    dataIndex: 'compressedSize',
    title: 'Compressed',
    width: 140,
    compare: compareNumericField('compressedSize'),
    exportValue: (row) => row.compressedSize,
  }),
  Object.freeze({
    key: 'physicalOrder',
    dataIndex: 'physicalOrder',
    title: 'Order',
    width: 100,
    compare: compareNumericField('physicalOrder'),
    exportValue: (row) => row.physicalOrder,
  }),
]);

const PACKAGE_TABLE_DEFAULT_SORT = Object.freeze({
  columnKey: 'physicalOrder',
  order: 'ascend',
});

function buildPackageRows(result) {
  const packages = Array.isArray(result?.packages) ? result.packages : [];
  const duplicateCounts = new Map();
  const usedIds = new Set();
  const rows = packages.reduce((draftRows, packageEntry) => {
    if (!isRecord(packageEntry)) {
      return draftRows;
    }

    const fullPath = firstPathValue(packageEntry);
    if (!fullPath) {
      return draftRows;
    }

    const fileName = fileNameFromPath(fullPath);
    const type = typeFromFileName(fileName);
    const size = firstFiniteNumber([
      packageEntry.size,
      packageEntry.diskSize,
      packageEntry.disk_size,
      packageEntry.uncompressedSize,
      packageEntry.uncompressed_size,
    ]);
    const compressedSize = firstFiniteNumber([
      packageEntry.compressedSize,
      packageEntry.compressed_size,
    ]);
    const physicalOrder = firstFiniteNumber([
      packageEntry.order,
      packageEntry.physicalOrder,
      packageEntry.physical_order,
    ]);
    const row = { fullPath, fileName, source: packageEntry };

    if (type !== undefined) row.type = type;
    if (size !== undefined) row.size = size;
    if (compressedSize !== undefined) row.compressedSize = compressedSize;
    if (physicalOrder !== undefined) row.physicalOrder = physicalOrder;

    draftRows.push(row);
    return draftRows;
  }, []);

  const reservedIds = new Set(rows.map((row) => row.fullPath));

  return rows
    .sort(comparePackagePath)
    .map((row) => ({
      id: allocatePackageId(row, duplicateCounts, usedIds, reservedIds),
      ...row,
    }));
}

function sortPackageRows(rows, sortState = PACKAGE_TABLE_DEFAULT_SORT) {
  const effectiveSort = sortState || PACKAGE_TABLE_DEFAULT_SORT;
  const column = PACKAGE_TABLE_COLUMNS.find((candidate) => candidate.key === effectiveSort.columnKey);
  if (column?.compare) {
    return [...rows].sort((left, right) => column.compare(left, right, effectiveSort.order));
  }

  const direction = effectiveSort.order === 'descend' ? -1 : 1;
  const compare = column?.compare || comparePackageFileName;
  return [...rows].sort((left, right) => compare(left, right) * direction);
}

function csvCell(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function serializePackagesCsv(rows, columns = PACKAGE_TABLE_COLUMNS) {
  const lines = [
    columns.map((column) => csvCell(column.title)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column.exportValue(row))).join(',')),
  ];
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

module.exports = {
  PACKAGE_TABLE_COLUMNS,
  PACKAGE_TABLE_DEFAULT_SORT,
  buildPackageRows,
  comparePackageFileName,
  comparePackageOrder,
  serializePackagesCsv,
  sortPackageRows,
};
