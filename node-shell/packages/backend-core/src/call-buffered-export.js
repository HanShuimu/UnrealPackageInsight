const CALL_OK = 0;
const CALL_BUFFER_TOO_SMALL = 1;

function createRequiredSizePointer(koffi) {
  if (koffi && typeof koffi.alloc === 'function') {
    return koffi.alloc('int', 1);
  }

  return [0];
}

function readRequiredSize(requiredSize, koffi) {
  if (Buffer.isBuffer(requiredSize)) {
    return requiredSize.readInt32LE(0);
  }

  if (Array.isArray(requiredSize) || ArrayBuffer.isView(requiredSize)) {
    return Number(requiredSize[0]);
  }

  if (requiredSize && typeof requiredSize.value === 'number') {
    return requiredSize.value;
  }

  if (koffi && typeof koffi.decode === 'function') {
    return Number(koffi.decode(requiredSize, 'int'));
  }

  return Number(requiredSize);
}

function validateCapacity(capacity, label) {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function callOnce({ fn, args, capacity, koffi }) {
  const output = Buffer.alloc(capacity);
  const requiredSize = createRequiredSizePointer(koffi);
  const status = fn(...args, output, capacity, requiredSize);
  return {
    output,
    requiredSize: readRequiredSize(requiredSize, koffi),
    status,
  };
}

function sliceOutput(output, requiredSize) {
  if (!Number.isInteger(requiredSize) || requiredSize < 0 || requiredSize > output.length) {
    throw new Error(`Invalid buffered export output size: ${requiredSize}`);
  }

  return output.subarray(0, requiredSize);
}

function throwStatus(status) {
  throw new Error(`Backend export failed with status ${status}`);
}

function callBufferedExport({ fn, koffi, args = [], initialSize = 4096 }) {
  if (typeof fn !== 'function') {
    throw new TypeError('callBufferedExport requires fn to be a function');
  }

  validateCapacity(initialSize, 'initialSize');

  const first = callOnce({ fn, args, capacity: initialSize, koffi });
  if (first.status === CALL_OK) {
    return sliceOutput(first.output, first.requiredSize);
  }

  if (first.status !== CALL_BUFFER_TOO_SMALL) {
    throwStatus(first.status);
  }

  if (!Number.isInteger(first.requiredSize) || first.requiredSize <= initialSize) {
    throw new Error(`Invalid buffered export resize: ${first.requiredSize}`);
  }

  const second = callOnce({ fn, args, capacity: first.requiredSize, koffi });
  if (second.status === CALL_OK) {
    return sliceOutput(second.output, second.requiredSize);
  }

  throwStatus(second.status);
}

module.exports = {
  CALL_OK,
  CALL_BUFFER_TOO_SMALL,
  callBufferedExport,
};
