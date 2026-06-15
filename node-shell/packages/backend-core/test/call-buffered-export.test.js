const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CALL_BUFFER_TOO_SMALL,
  CALL_OK,
  callBufferedExport,
} = require('../src/call-buffered-export.js');

test('callBufferedExport retries once with the required output size', () => {
  const payload = Buffer.from('backend-info');
  const capacities = [];

  const result = callBufferedExport({
    initialSize: 4,
    fn(output, capacity, requiredSize) {
      capacities.push(capacity);

      if (capacity < payload.length) {
        requiredSize[0] = payload.length;
        return CALL_BUFFER_TOO_SMALL;
      }

      payload.copy(output);
      requiredSize[0] = payload.length;
      return CALL_OK;
    },
  });

  assert.deepEqual(capacities, [4, payload.length]);
  assert.deepEqual(result, payload);
});

test('callBufferedExport passes leading arguments before output buffers', () => {
  const payload = Buffer.from('pak');
  const calls = [];

  const result = callBufferedExport({
    args: ['Example.pak', ''],
    initialSize: 8,
    fn(pakPath, aesKey, output, capacity, requiredSize) {
      calls.push({ pakPath, aesKey, capacity });
      payload.copy(output);
      requiredSize[0] = payload.length;
      return CALL_OK;
    },
  });

  assert.deepEqual(calls, [{ pakPath: 'Example.pak', aesKey: '', capacity: 8 }]);
  assert.deepEqual(result, payload);
});

test('callBufferedExport uses int32 koffi pointers for required output size', () => {
  const payload = Buffer.from('info');
  const allocTypes = [];
  const decodeTypes = [];
  const koffi = {
    alloc(type, length) {
      allocTypes.push({ type, length });
      return { requiredSize: 0 };
    },
    decode(pointer, type) {
      decodeTypes.push(type);
      return pointer.requiredSize;
    },
  };

  const result = callBufferedExport({
    koffi,
    initialSize: 2,
    fn(output, capacity, requiredSize) {
      if (capacity < payload.length) {
        requiredSize.requiredSize = payload.length;
        return CALL_BUFFER_TOO_SMALL;
      }

      payload.copy(output);
      requiredSize.requiredSize = payload.length;
      return CALL_OK;
    },
  });

  assert.deepEqual(result, payload);
  assert.deepEqual(allocTypes, [
    { type: 'int32', length: 1 },
    { type: 'int32', length: 1 },
  ]);
  assert.deepEqual(decodeTypes, ['int32', 'int32']);
});

test('callBufferedExport throws when the resized capacity is invalid', () => {
  assert.throws(
    () =>
      callBufferedExport({
        initialSize: 8,
        fn(output, capacity, requiredSize) {
          requiredSize[0] = capacity;
          return CALL_BUFFER_TOO_SMALL;
        },
      }),
    /Invalid buffered export resize/
  );
});

test('callBufferedExport throws on non-success statuses', () => {
  assert.throws(
    () =>
      callBufferedExport({
        fn(output, capacity, requiredSize) {
          requiredSize[0] = 0;
          return 42;
        },
      }),
    /Backend export failed with status 42/
  );
});
