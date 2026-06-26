import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  serializePackagesCsv,
  sortPackageRows,
  type PackageRow,
  type PackageTableSortState,
} from '../../../../../packages/analysis-domain/src/packages-table-export.js';
import type {
  AnalysisResult,
  BackendInfo,
  BackendSelectionRequest,
  ExtractResult,
  Issue,
  PackageScan,
  UpiClient,
} from '../types/upi';

const DEFAULT_AES_MESSAGE = 'Enter the key for this container and analyze again.';

export type PackagesCsvExportDialog = {
  kind: 'success' | 'error';
  title: string;
  message: string;
};

export type DialogState = {
  aesFilePath: string;
  aesMessage: string;
  backendSelection: BackendSelectionRequest | null;
  backendSelectionRequestId: number;
  packagesCsvExport: PackagesCsvExportDialog | null;
};

export type AppState = {
  backendInfo: BackendInfo | null;
  scan: PackageScan | null;
  selectedFilePath: string;
  analysisResult: AnalysisResult | null;
  statusText: string;
  isOpeningDirectory: boolean;
  isAnalyzing: boolean;
  isExtracting: boolean;
  isExportingPackagesCsv: boolean;
  analysisRequestId: number;
  extractRequestId: number;
  packagesCsvExportRequestId: number;
  openDirectoryRequestId: number;
  dialog: DialogState;
  loadBackendInfo(): Promise<void>;
  openDirectory(): Promise<void>;
  analyzeFile(filePath: string): Promise<void>;
  extractSelectedContainer(): Promise<void>;
  exportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState): Promise<void>;
  submitAesKey(aesKey: string): Promise<void>;
  cancelAesDialog(): void;
  dismissPackagesCsvExportDialog(): void;
  openBackendSelection(): Promise<void>;
  chooseBackend(selectedId: string): Promise<void>;
  cancelBackendDialog(): void;
};

function createDialogState(overrides: Partial<DialogState> = {}): DialogState {
  return {
    aesFilePath: '',
    aesMessage: DEFAULT_AES_MESSAGE,
    backendSelection: null,
    backendSelectionRequestId: 0,
    packagesCsvExport: null,
    ...overrides,
  };
}

function hasIssues(result: { issues?: Issue[] } | null | undefined): boolean {
  return Array.isArray(result?.issues) && result.issues.length > 0;
}

function getIssueCode(issue: Issue): string {
  return String(issue.code || '');
}

function needsAesKey(result: AnalysisResult | null | undefined): boolean {
  return Boolean(result?.issues?.some((issue) => getIssueCode(issue).endsWith('.aes_key_required')));
}

function hasAesKeyInvalidIssue(result: AnalysisResult | null | undefined): boolean {
  return Boolean(result?.issues?.some((issue) => getIssueCode(issue).endsWith('.aes_key_invalid')));
}

function hasIssueCode(result: AnalysisResult | null | undefined, code: string): boolean {
  return Boolean(result?.issues?.some((issue) => getIssueCode(issue) === code));
}

function hasAesRetryIssue(result: AnalysisResult | null | undefined): boolean {
  return hasIssueCode(result, 'aes.invalid_key') || hasAesKeyInvalidIssue(result) || needsAesKey(result);
}

function getFirstIssueMessage(result: AnalysisResult | null | undefined, fallback: string): string {
  const issue = Array.isArray(result?.issues) ? result.issues[0] : null;
  return issue?.message || fallback;
}

function formatScanStatus(scan: PackageScan): string {
  const count = Array.isArray(scan.files) ? scan.files.length : 0;
  return count === 1 ? '1 file found' : `${count} files found`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown error');
}

function createErrorResult(code: string, error: unknown): AnalysisResult {
  return {
    status: 'Error',
    issues: [
      {
        severity: 'error',
        code,
        message: getErrorMessage(error),
      },
    ],
  };
}

function isErrorStatus(status: unknown): boolean {
  return status === 'Error' || status === 1;
}

function createFallbackExtractIssue(): Issue {
  return {
    severity: 'error',
    code: 'renderer.extract_failed',
    message: 'Extraction failed.',
  };
}

function createAnalysisResultFromExtract(result: ExtractResult): AnalysisResult {
  const issues = Array.isArray(result.issues) ? result.issues : [];

  return {
    status: result.status,
    issues: issues.length > 0 ? issues : [createFallbackExtractIssue()],
  };
}

function isCurrentAnalysis(state: AppState, filePath: string, requestId: number): boolean {
  return state.selectedFilePath === filePath && state.analysisRequestId === requestId;
}

function isCurrentExtract(
  state: AppState,
  filePath: string,
  extractRequestId: number,
  analysisRequestId: number,
): boolean {
  return state.selectedFilePath === filePath
    && state.extractRequestId === extractRequestId
    && state.analysisRequestId === analysisRequestId;
}

function isCurrentPackagesCsvExport(
  state: AppState,
  filePath: string,
  requestId: number,
  analysisRequestId: number,
): boolean {
  return state.selectedFilePath === filePath
    && state.packagesCsvExportRequestId === requestId
    && state.analysisRequestId === analysisRequestId;
}

function isCurrentOpenDirectory(state: AppState, requestId: number): boolean {
  return state.openDirectoryRequestId === requestId;
}

function isCurrentBackendSelection(
  state: AppState,
  backendSelection: BackendSelectionRequest,
  requestId: number,
): boolean {
  const analysisFilePath = backendSelection.analysisFilePath || backendSelection.filePath;
  return state.dialog.backendSelection === backendSelection
    && state.dialog.backendSelectionRequestId === requestId
    && state.analysisRequestId === requestId
    && (!analysisFilePath || state.selectedFilePath === analysisFilePath);
}

function isSameAnalysisContext(state: AppState, filePath: string | undefined, requestId: number): boolean {
  return state.analysisRequestId === requestId && (!filePath || state.selectedFilePath === filePath);
}

function normalizeBackendSelection(
  backendSelection: BackendSelectionRequest,
  analysisFilePath: string,
): BackendSelectionRequest {
  return {
    ...backendSelection,
    filePath: backendSelection.filePath || analysisFilePath,
    analysisFilePath,
  };
}

function getAesStatusText(result: AnalysisResult): string {
  return needsAesKey(result) ? 'AES key required' : 'AES key invalid';
}

function getAesDialogMessage(result: AnalysisResult): string {
  return getFirstIssueMessage(result, needsAesKey(result) ? 'AES key required.' : 'Invalid AES key.');
}

export function createAppStore(client: UpiClient): StoreApi<AppState> {
  return createStore<AppState>((set, get) => ({
    backendInfo: null,
    scan: null,
    selectedFilePath: '',
    analysisResult: null,
    statusText: 'Idle',
    isOpeningDirectory: false,
    isAnalyzing: false,
    isExtracting: false,
    isExportingPackagesCsv: false,
    analysisRequestId: 0,
    extractRequestId: 0,
    packagesCsvExportRequestId: 0,
    openDirectoryRequestId: 0,
    dialog: createDialogState(),

    async loadBackendInfo() {
      set({ statusText: 'Loading backend...' });
      try {
        const backendInfo = await client.getBackendInfo();
        set({ backendInfo, statusText: hasIssues(backendInfo) ? 'Backend issue' : 'Ready' });
      } catch (error) {
        const result = createErrorResult('renderer.backend_info_failed', error);
        set({
          backendInfo: result,
          analysisResult: result,
          statusText: 'Backend error',
        });
      }
    },

    async openDirectory() {
      const requestId = get().openDirectoryRequestId + 1;
      set((state) => ({
        extractRequestId: state.extractRequestId + 1,
        packagesCsvExportRequestId: state.packagesCsvExportRequestId + 1,
        isExtracting: false,
        isExportingPackagesCsv: false,
        openDirectoryRequestId: requestId,
        isOpeningDirectory: true,
        statusText: 'Opening...',
        dialog: {
          ...state.dialog,
          packagesCsvExport: null,
        },
      }));
      try {
        const scan = await client.openPackageDirectory();
        if (!isCurrentOpenDirectory(get(), requestId)) {
          return;
        }

        if (!scan) {
          set({ statusText: 'Open canceled' });
          return;
        }

        set((state) => ({
          scan,
          selectedFilePath: '',
          analysisResult: null,
          dialog: createDialogState(),
          analysisRequestId: state.analysisRequestId + 1,
          extractRequestId: state.extractRequestId + 1,
          packagesCsvExportRequestId: state.packagesCsvExportRequestId + 1,
          isAnalyzing: false,
          isExtracting: false,
          isExportingPackagesCsv: false,
          statusText: formatScanStatus(scan),
        }));
      } catch (error) {
        if (!isCurrentOpenDirectory(get(), requestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.open_failed', error),
          statusText: 'Open failed',
        });
      } finally {
        if (isCurrentOpenDirectory(get(), requestId)) {
          set({ isOpeningDirectory: false });
        }
      }
    },

    async analyzeFile(filePath: string) {
      const requestId = get().analysisRequestId + 1;
      set((state) => ({
        selectedFilePath: filePath,
        analysisResult: null,
        statusText: 'Analyzing...',
        isAnalyzing: true,
        isExtracting: false,
        isExportingPackagesCsv: false,
        analysisRequestId: requestId,
        extractRequestId: state.extractRequestId + 1,
        packagesCsvExportRequestId: state.packagesCsvExportRequestId + 1,
        dialog: {
          ...state.dialog,
          aesFilePath: '',
          aesMessage: DEFAULT_AES_MESSAGE,
          backendSelection: null,
          backendSelectionRequestId: 0,
          packagesCsvExport: null,
        },
      }));

      try {
        const result = await client.analyze(filePath);
        if (!isCurrentAnalysis(get(), filePath, requestId)) {
          return;
        }

        if (result.backendSelection) {
          const backendSelection = normalizeBackendSelection(result.backendSelection, filePath);
          set({
            analysisResult: result,
            dialog: {
              ...get().dialog,
              backendSelection,
              backendSelectionRequestId: requestId,
            },
            statusText: 'Choose backend',
          });
          return;
        }

        if (hasAesRetryIssue(result)) {
          set({
            analysisResult: result,
            dialog: {
              ...get().dialog,
              aesFilePath: filePath,
              aesMessage: getAesDialogMessage(result),
            },
            statusText: getAesStatusText(result),
          });
          return;
        }

        set({
          analysisResult: result,
          dialog: createDialogState(),
          statusText: 'Analysis ready',
        });
      } catch (error) {
        if (!isCurrentAnalysis(get(), filePath, requestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.analysis_failed', error),
          dialog: createDialogState(),
          statusText: 'Analysis failed',
        });
      } finally {
        if (isCurrentAnalysis(get(), filePath, requestId)) {
          set({ isAnalyzing: false });
        }
      }
    },

    async extractSelectedContainer() {
      const filePath = get().selectedFilePath;
      if (!filePath) {
        set({ statusText: 'Select a container first' });
        return;
      }

      const requestId = get().extractRequestId + 1;
      const analysisRequestId = get().analysisRequestId;
      set({ extractRequestId: requestId, isExtracting: true, statusText: 'Extracting...' });

      try {
        const result = await client.extractSelectedContainer(filePath);
        if (!isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        if (!result) {
          set({ statusText: 'Extract canceled' });
          return;
        }

        if (isErrorStatus(result.status)) {
          set({
            analysisResult: createAnalysisResultFromExtract(result),
            statusText: 'Extract failed',
          });
          return;
        }

        set({ statusText: 'Extract complete' });
      } catch (error) {
        if (!isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.extract_failed', error),
          statusText: 'Extract failed',
        });
      } finally {
        if (isCurrentExtract(get(), filePath, requestId, analysisRequestId)) {
          set({ isExtracting: false });
        }
      }
    },

    async exportPackagesCsv(rows: PackageRow[], sortState: PackageTableSortState) {
      const filePath = get().selectedFilePath;
      if (!filePath) {
        set((state) => ({
          statusText: 'CSV export failed',
          dialog: {
            ...state.dialog,
            packagesCsvExport: {
              kind: 'error',
              title: 'CSV export failed',
              message: 'Select a container first.',
            },
          },
        }));
        return;
      }

      if (rows.length === 0) {
        set((state) => ({
          statusText: 'CSV export failed',
          dialog: {
            ...state.dialog,
            packagesCsvExport: {
              kind: 'error',
              title: 'CSV export failed',
              message: 'No packages to export.',
            },
          },
        }));
        return;
      }

      const requestId = get().packagesCsvExportRequestId + 1;
      const analysisRequestId = get().analysisRequestId;
      set((state) => ({
        packagesCsvExportRequestId: requestId,
        isExportingPackagesCsv: true,
        statusText: 'Exporting CSV...',
        dialog: {
          ...state.dialog,
          packagesCsvExport: null,
        },
      }));

      try {
        const sortedRows = sortPackageRows(rows, sortState);
        const csvText = serializePackagesCsv(sortedRows);
        const result = await client.exportPackagesCsv(filePath, csvText);
        if (!isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        if (result.canceled) {
          set({ statusText: 'CSV export canceled' });
          return;
        }

        const countLabel = sortedRows.length === 1 ? '1 package exported.' : `${sortedRows.length} packages exported.`;
        set((state) => ({
          statusText: 'CSV exported',
          dialog: {
            ...state.dialog,
            packagesCsvExport: {
              kind: 'success',
              title: 'CSV exported',
              message: `${result.filePath}\n${countLabel}`,
            },
          },
        }));
      } catch (error) {
        if (!isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
          return;
        }

        set((state) => ({
          statusText: 'CSV export failed',
          dialog: {
            ...state.dialog,
            packagesCsvExport: {
              kind: 'error',
              title: 'CSV export failed',
              message: getErrorMessage(error),
            },
          },
        }));
      } finally {
        if (isCurrentPackagesCsvExport(get(), filePath, requestId, analysisRequestId)) {
          set({ isExportingPackagesCsv: false });
        }
      }
    },

    async submitAesKey(aesKey: string) {
      const filePath = get().dialog.aesFilePath;
      if (!filePath) {
        return;
      }

      const requestId = get().analysisRequestId + 1;
      set((state) => ({
        analysisRequestId: requestId,
        isAnalyzing: true,
        statusText: 'Retrying analysis...',
        dialog: {
          ...state.dialog,
          aesMessage: 'Analyzing with AES key...',
        },
      }));

      try {
        const result = await client.submitAesKeyAndRetry(filePath, aesKey.trim());
        if (!isCurrentAnalysis(get(), filePath, requestId)) {
          return;
        }

        if (hasAesRetryIssue(result)) {
          set({
            analysisResult: result,
            dialog: {
              ...get().dialog,
              aesFilePath: filePath,
              aesMessage: getAesDialogMessage(result),
            },
            statusText: getAesStatusText(result),
          });
          return;
        }

        set({
          analysisResult: result,
          dialog: createDialogState(),
          statusText: 'Analysis ready',
        });
      } catch (error) {
        if (!isCurrentAnalysis(get(), filePath, requestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.aes_retry_failed', error),
          dialog: createDialogState(),
          statusText: 'AES retry failed',
        });
      } finally {
        if (isCurrentAnalysis(get(), filePath, requestId)) {
          set({ isAnalyzing: false });
        }
      }
    },

    cancelAesDialog() {
      set((state) => ({
        dialog: {
          ...state.dialog,
          aesFilePath: '',
          aesMessage: DEFAULT_AES_MESSAGE,
        },
      }));
    },

    dismissPackagesCsvExportDialog() {
      set((state) => ({
        dialog: {
          ...state.dialog,
          packagesCsvExport: null,
        },
      }));
    },

    async openBackendSelection() {
      const filePath = get().selectedFilePath;
      if (!filePath) {
        set({ statusText: 'Select a container first' });
        return;
      }

      const requestId = get().analysisRequestId;
      set({ statusText: 'Loading backend choices...' });

      try {
        const backendSelectionRequest = await client.requestBackendSelection(filePath);
        if (!isSameAnalysisContext(get(), filePath, requestId)) {
          return;
        }

        if (!backendSelectionRequest) {
          set({ statusText: 'No backend choices' });
          return;
        }

        set((state) => ({
          dialog: {
            ...state.dialog,
            backendSelection: normalizeBackendSelection(backendSelectionRequest, filePath),
            backendSelectionRequestId: requestId,
          },
          statusText: 'Choose backend',
        }));
      } catch (error) {
        if (!isSameAnalysisContext(get(), filePath, requestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.backend_selection_failed', error),
          dialog: createDialogState(),
          statusText: 'Backend selection failed',
        });
      }
    },

    async chooseBackend(selectedId: string) {
      const backendSelection = get().dialog.backendSelection;
      const requestId = get().dialog.backendSelectionRequestId;
      if (!backendSelection) {
        return;
      }

      if (!isCurrentBackendSelection(get(), backendSelection, requestId)) {
        return;
      }

      try {
        const resolvedId = await client.chooseBackend({ ...backendSelection, selectedId });
        if (!isCurrentBackendSelection(get(), backendSelection, requestId)) {
          return;
        }

        set((state) => ({
          dialog: {
            ...state.dialog,
            backendSelection: null,
            backendSelectionRequestId: 0,
          },
        }));

        if (!resolvedId) {
          set({ statusText: 'Backend selection canceled' });
          return;
        }

        const analysisFilePath = backendSelection.analysisFilePath || backendSelection.filePath;
        if (analysisFilePath) {
          await get().analyzeFile(analysisFilePath);
        }
      } catch (error) {
        if (!isCurrentBackendSelection(get(), backendSelection, requestId)) {
          return;
        }

        set({
          analysisResult: createErrorResult('renderer.backend_choose_failed', error),
          dialog: createDialogState(),
          statusText: 'Backend selection failed',
        });
      }
    },

    cancelBackendDialog() {
      const backendSelection = get().dialog.backendSelection;
      const requestId = get().dialog.backendSelectionRequestId;
      if (!backendSelection || !isCurrentBackendSelection(get(), backendSelection, requestId)) {
        return;
      }

      set((state) => ({
        dialog: {
          ...state.dialog,
          backendSelection: null,
          backendSelectionRequestId: 0,
        },
        statusText: 'Backend selection canceled',
      }));

      void client.chooseBackend({ ...backendSelection, selectedId: '' }).catch((error) => {
        const analysisFilePath = backendSelection.analysisFilePath || backendSelection.filePath;
        if (isSameAnalysisContext(get(), analysisFilePath, requestId)) {
          set({
            analysisResult: createErrorResult('renderer.backend_cancel_failed', error),
            statusText: 'Backend selection cancel failed',
          });
        }
      });
    },
  }));
}
