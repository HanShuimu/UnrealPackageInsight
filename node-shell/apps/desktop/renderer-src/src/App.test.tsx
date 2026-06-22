import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import type { AppState } from './stores/appStore';

type ObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

const mockHarness = vi.hoisted(() => ({
  actions: {
    analyzeFile: vi.fn(() => Promise.resolve()),
    cancelAesDialog: vi.fn(),
    cancelBackendDialog: vi.fn(),
    chooseBackend: vi.fn(() => Promise.resolve()),
    loadBackendInfo: vi.fn(() => Promise.resolve()),
    openDirectory: vi.fn(() => Promise.resolve()),
    submitAesKey: vi.fn(() => Promise.resolve()),
  },
  observers: [] as ObserverRecord[],
  state: null as AppState | null,
}));

class ResizeObserverMock implements ResizeObserver {
  private readonly record: ObserverRecord;

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: new Set<Element>() };
    mockHarness.observers.push(this.record);
  }

  disconnect(): void {
    this.record.targets.clear();
  }

  observe(target: Element): void {
    this.record.targets.add(target);
  }

  unobserve(target: Element): void {
    this.record.targets.delete(target);
  }
}

vi.mock('./stores/useAppStore', () => ({
  useAppStore: <T,>(selector: (state: AppState) => T) => selector(mockHarness.state as AppState),
}));

vi.mock('./components/AnalysisTabs', () => ({
  AnalysisTabs: ({ tableHeight }: { tableHeight: number }) => (
    <div data-testid="analysis-tabs" data-height={tableHeight} />
  ),
}));

vi.mock('./components/PackageTree', () => ({
  PackageTree: ({ height, onSelectFile }: { height: number; onSelectFile(filePath: string): void }) => (
    <button data-testid="package-tree" data-height={height} onClick={() => onSelectFile('C:\\Paks\\A.pak')}>
      Package tree
    </button>
  ),
}));

function createMockState(overrides: Partial<AppState> = {}): AppState {
  const state: AppState = {
    analysisRequestId: 0,
    analysisResult: null,
    backendInfo: { backendName: 'TestBackend', backendVersion: '1.0' },
    cancelAesDialog: mockHarness.actions.cancelAesDialog,
    cancelBackendDialog: mockHarness.actions.cancelBackendDialog,
    chooseBackend: mockHarness.actions.chooseBackend,
    dialog: {
      aesFilePath: '',
      aesMessage: '',
      backendSelection: null,
      backendSelectionRequestId: 0,
    },
    isAnalyzing: false,
    isOpeningDirectory: false,
    loadBackendInfo: mockHarness.actions.loadBackendInfo,
    openDirectory: mockHarness.actions.openDirectory,
    openDirectoryRequestId: 0,
    scan: null,
    selectedFilePath: '',
    statusText: 'Ready',
    submitAesKey: mockHarness.actions.submitAesKey,
    analyzeFile: mockHarness.actions.analyzeFile,
  };

  return {
    ...state,
    ...overrides,
    dialog: {
      ...state.dialog,
      ...overrides.dialog,
    },
  };
}

function resizeElement(selector: string, height: number): void {
  const target = document.querySelector(selector);

  if (!target) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  act(() => {
    mockHarness.observers.forEach((observer) => {
      if (!observer.targets.has(target)) {
        return;
      }

      observer.callback([
        {
          contentRect: { height },
          target,
        } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    });
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHarness.observers.length = 0;
    mockHarness.state = createMockState();
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  test('renders the desktop shell regions', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Backend' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/TestBackend/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Opened containers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByText('Selection-specific region')).toBeInTheDocument();
  });

  test('renders the UPI Final three-pane workspace shell', () => {
    mockHarness.state = createMockState({
      scan: {
        root: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows',
        files: [{ path: 'C:\\Paks\\pakchunk0-Windows.pak', kind: 'pak' }],
        tree: {
          name: 'Windows',
          kind: 'directory',
          children: [
            {
              name: 'Content',
              kind: 'directory',
              children: [
                { name: 'pakchunk0-Windows.pak', path: 'C:\\Paks\\pakchunk0-Windows.pak', kind: 'pak' },
              ],
            },
          ],
        },
      },
      selectedFilePath: 'C:\\Paks\\pakchunk0-Windows.pak',
    });

    const { container } = render(<App />);

    expect(screen.getByLabelText('Package root')).toHaveTextContent(
      'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows',
    );
    expect(container.querySelector('.workspace-panels')).toBeInTheDocument();
    expect(screen.getByText('Single selected source')).toBeInTheDocument();
    expect(screen.getByText('Selected resource')).toBeInTheDocument();
    expect(screen.getByText('pakchunk0-Windows.pak')).toBeInTheDocument();
    expect(screen.getByText('Pak')).toBeInTheDocument();
  });

  test('summarizes backend registry info in the shell header', () => {
    mockHarness.state = createMockState({
      backendInfo: {
        status: 'OK',
        backendCount: 2,
        backends: [
          { id: 'ue-5.7-development', label: 'UE 5.7 Development' },
          { id: 'ue-5.7-shipping', label: 'UE 5.7 Shipping' },
        ],
      },
    });

    render(<App />);

    expect(screen.getByLabelText('Backend: 2 backends available')).toHaveClass('status-value');
  });

  test('loads backend info on mount and opens directories from the toolbar', async () => {
    render(<App />);

    await waitFor(() => expect(mockHarness.actions.loadBackendInfo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(mockHarness.actions.openDirectory).toHaveBeenCalledTimes(1);
  });

  test('passes measured region heights to virtualized regions', async () => {
    render(<App />);

    resizeElement('.tree-content', 321);
    resizeElement('.analysis-tabs-region', 456);

    await waitFor(() => {
      expect(screen.getByTestId('package-tree')).toHaveAttribute('data-height', '321');
      expect(screen.getByTestId('analysis-tabs')).toHaveAttribute('data-height', '456');
    });
  });

  test('exposes constrained labels for long shell values', () => {
    mockHarness.state = createMockState({
      backendInfo: {
        backendName: 'VeryLongBackendNameThatShouldNotStretchTheToolbar',
        backendVersion: '2026.06.17-preview-build',
      },
      selectedFilePath: 'C:\\Extremely\\Long\\Path\\That\\Should\\Be\\Ellipsized\\Container.pak',
      statusText: 'Ready with a verbose status message that should stay inside the toolbar',
    });

    render(<App />);

    expect(screen.getByLabelText(
      'Status: Ready with a verbose status message that should stay inside the toolbar',
    )).toHaveClass('status-value');
    expect(screen.getByLabelText(
      /Backend: VeryLongBackendNameThatShouldNotStretchTheToolbar/,
    )).toHaveClass('status-value');
    expect(screen.getByLabelText(
      'Selected file: C:\\Extremely\\Long\\Path\\That\\Should\\Be\\Ellipsized\\Container.pak',
    )).toHaveClass('selected-value');
  });
});
