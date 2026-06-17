import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  AnalysisResult,
  BackendInfo,
  BackendSelectionRequest,
  Issue,
  PackageScan,
  UpiClient,
} from '../types/upi';

const DEFAULT_AES_MESSAGE = 'Enter the key for this container and analyze again.';

export type DialogState = {
  aesFilePath: string;
  aesMessage: string;
  backendSelection: BackendSelectionRequest | null;
};

export type AppState = {
  backendInfo: BackendInfo | null;
  scan: PackageScan | null;
  selectedFilePath: string;
  analysisResult: AnalysisResult | null;
  statusText: string;
  isOpeningDirectory: boolean;
  isAnalyzing: boolean;
  analysisRequestId: number;
  dialog: DialogState;
  loadBackendInfo(): Promise<void>;
  openDirectory(): Promise<void>;
  analyzeFile(filePath: string): Promise<void>;
  submitAesKey(aesKey: string): Promise<void>;
  cancelAesDialog(): void;
  chooseBackend(selectedId: string): Promise<void>;
  cancelBackendDialog(): void;
};

function createDialogState(overrides: Partial<DialogState> = {}): DialogState {
  return {
    aesFilePath: '',
    aesMessage: DEFAULT_AES_MESSAGE,
    backendSelection: null,
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

function isCurrentAnalysis(state: AppState, filePath: string, requestId: number): boolean {
  return state.selectedFilePath === filePath && state.analysisRequestId === requestId;
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
    analysisRequestId: 0,
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
      set({ isOpeningDirectory: true, statusText: 'Opening...' });
      try {
        const scan = await client.openPackageDirectory();
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
          statusText: formatScanStatus(scan),
        }));
      } catch (error) {
        set({
          analysisResult: createErrorResult('renderer.open_failed', error),
          statusText: 'Open failed',
        });
      } finally {
        set({ isOpeningDirectory: false });
      }
    },

    async analyzeFile(filePath: string) {
      const requestId = get().analysisRequestId + 1;
      set((state) => ({
        selectedFilePath: filePath,
        analysisResult: null,
        statusText: 'Analyzing...',
        isAnalyzing: true,
        analysisRequestId: requestId,
        dialog: {
          ...state.dialog,
          aesFilePath: '',
          aesMessage: DEFAULT_AES_MESSAGE,
          backendSelection: null,
        },
      }));

      try {
        const result = await client.analyze(filePath);
        if (!isCurrentAnalysis(get(), filePath, requestId)) {
          return;
        }

        if (result.backendSelection) {
          set({
            analysisResult: result,
            dialog: { ...get().dialog, backendSelection: result.backendSelection },
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

    async chooseBackend(selectedId: string) {
      const backendSelection = get().dialog.backendSelection;
      if (!backendSelection) {
        return;
      }

      try {
        const resolvedId = await client.chooseBackend({ ...backendSelection, selectedId });
        if (backendSelection.filePath && get().selectedFilePath !== backendSelection.filePath) {
          return;
        }

        set((state) => ({ dialog: { ...state.dialog, backendSelection: null } }));

        if (!resolvedId) {
          set({ statusText: 'Backend selection canceled' });
          return;
        }

        if (backendSelection.filePath) {
          await get().analyzeFile(backendSelection.filePath);
        }
      } catch (error) {
        if (backendSelection.filePath && get().selectedFilePath !== backendSelection.filePath) {
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
      set((state) => ({
        dialog: { ...state.dialog, backendSelection: null },
        statusText: 'Backend selection canceled',
      }));

      if (backendSelection) {
        void client.chooseBackend({ ...backendSelection, selectedId: '' }).catch((error) => {
          set({
            analysisResult: createErrorResult('renderer.backend_cancel_failed', error),
            statusText: 'Backend selection cancel failed',
          });
        });
      }
    },
  }));
}
