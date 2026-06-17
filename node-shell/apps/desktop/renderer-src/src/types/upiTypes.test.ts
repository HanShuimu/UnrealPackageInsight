/// <reference path="../ipc/global.d.ts" />

import { describe, expect, test } from 'vitest';
import type { AnalysisResult, BackendInfo, Issue } from './upi';

const decodedIssue: Issue = {
  severity: 2,
};

const decodedBackendInfo: BackendInfo = {
  status: 1,
  protocolVersion: 3,
};

const decodedAnalysisResult: AnalysisResult = {
  status: 4,
};

const missingPreloadApi: Window['upi'] = undefined;

describe('UPI renderer types', () => {
  test('accepts numeric enum values decoded from IPC responses', () => {
    expect(decodedIssue.severity).toBe(2);
    expect(decodedBackendInfo.status).toBe(1);
    expect(decodedBackendInfo.protocolVersion).toBe(3);
    expect(decodedAnalysisResult.status).toBe(4);
    expect(missingPreloadApi).toBeUndefined();
  });
});
