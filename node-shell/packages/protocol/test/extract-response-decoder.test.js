const assert = require('node:assert/strict');
const test = require('node:test');
const flatbuffers = require('flatbuffers');

const {
  ExtractResponse,
  Issue,
  IssueSeverity,
  ResponseStatus,
} = require('../generated/js/upi/v1.js');
const { decodeExtractResponse } = require('../src/extract-response-decoder.js');

function buildExtractResponse() {
  const builder = new flatbuffers.Builder(256);
  const code = builder.createString('extract.failed');
  const message = builder.createString('Extraction failed.');
  const issue = Issue.createIssue(builder, IssueSeverity.Error, code, message);
  const issues = ExtractResponse.createIssuesVector(builder, [issue]);
  const containerPath = builder.createString('C:\\Paks\\A.pak');
  const outputDirectory = builder.createString('D:\\Extracted');

  ExtractResponse.startExtractResponse(builder);
  ExtractResponse.addSchemaVersion(builder, 1);
  ExtractResponse.addStatus(builder, ResponseStatus.Error);
  ExtractResponse.addIssues(builder, issues);
  ExtractResponse.addContainerPath(builder, containerPath);
  ExtractResponse.addOutputDirectory(builder, outputDirectory);
  ExtractResponse.addExtractedFileCount(builder, 3);
  ExtractResponse.addErrorCount(builder, 1);
  const response = ExtractResponse.endExtractResponse(builder);
  ExtractResponse.finishExtractResponseBuffer(builder, response);
  return Buffer.from(builder.asUint8Array());
}

test('decodeExtractResponse decodes status, paths, counts, and issues', () => {
  assert.deepEqual(decodeExtractResponse(buildExtractResponse()), {
    schemaVersion: 1,
    status: ResponseStatus.Error,
    issues: [{
      severity: IssueSeverity.Error,
      code: 'extract.failed',
      message: 'Extraction failed.',
    }],
    containerPath: 'C:\\Paks\\A.pak',
    outputDirectory: 'D:\\Extracted',
    extractedFileCount: 3,
    errorCount: 1,
  });
});

test('decodeExtractResponse rejects buffers with the wrong identifier', () => {
  assert.throws(
    () => decodeExtractResponse(Buffer.from([0, 1, 2, 3])),
    /Invalid ExtractResponse identifier/,
  );
});
