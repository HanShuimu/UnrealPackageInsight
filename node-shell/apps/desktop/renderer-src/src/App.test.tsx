import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App';
import type { AppState } from './stores/appStore';
import type { DetailSelection } from './utils/analysisViewModel';

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
  AnalysisTabs: ({
    onDetailsSelectionChange,
    selectedPackageId,
    tableHeight,
  }: {
    onDetailsSelectionChange(selection: DetailSelection | null): void;
    selectedPackageId: string;
    tableHeight: number;
  }) => (
    <div
      data-selected-package-id={selectedPackageId}
      data-testid="analysis-tabs"
      data-height={tableHeight}
    >
      <button
        type="button"
        onClick={() => onDetailsSelectionChange({
          kind: 'package',
          row: {
            id: '../../../Engine/Config/Base.ini',
            fullPath: '../../../Engine/Config/Base.ini',
            fileName: 'Base.ini',
            physicalOrder: 0,
            source: {},
          },
        })}
      >
        Select package detail
      </button>
    </div>
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

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });
}

function openedPaneStyleWidth(container: HTMLElement): number {
  const panels = container.querySelector('.workspace-panels') as HTMLElement | null;

  if (!panels) {
    throw new Error('Missing workspace panels');
  }

  const match = /^(\d+)px$/.exec(panels.style.getPropertyValue('--opened-pane-width').trim());

  if (!match) {
    throw new Error(`Missing opened pane CSS variable: ${panels.getAttribute('style') || ''}`);
  }

  return Number(match[1]);
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHarness.observers.length = 0;
    mockHarness.state = createMockState();
    setViewportWidth(1024);
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
    expect(screen.queryByText('Selection-specific region')).not.toBeInTheDocument();
    expect(screen.queryByText('Selected resource')).not.toBeInTheDocument();
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
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toBe('Details');
    expect(screen.queryByText('Selected resource')).not.toBeInTheDocument();
    expect(screen.queryByText('pakchunk0-Windows.pak')).not.toBeInTheDocument();
    expect(screen.queryByText('Pak')).not.toBeInTheDocument();
  });

  test('keeps the details region empty until a result row is selected', () => {
    mockHarness.state = createMockState({
      analysisResult: {
        overview: { packageCount: 1 },
        packages: [{ packagePath: '../../../Engine/Config/Base.ini', order: 0 }],
      },
      selectedFilePath: 'C:\\Paks\\pakchunk0-Windows.pak',
    });

    render(<App />);

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details.textContent).toBe('Details');

    fireEvent.click(screen.getByRole('button', { name: 'Select package detail' }));

    expect(details).toHaveTextContent('../../../Engine/Config/Base.ini');
    expect(screen.getByTestId('analysis-tabs')).toHaveAttribute(
      'data-selected-package-id',
      '../../../Engine/Config/Base.ini',
    );
  });

  test('clears selected details when the selected file or analysis result changes', async () => {
    const firstResult = {
      overview: { packageCount: 1 },
      packages: [{ packagePath: '../../../Engine/Config/Base.ini', order: 0 }],
    };
    mockHarness.state = createMockState({
      analysisResult: firstResult,
      selectedFilePath: 'C:\\Paks\\pakchunk0-Windows.pak',
    });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select package detail' }));
    expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent(
      '../../../Engine/Config/Base.ini',
    );

    mockHarness.state = createMockState({
      analysisResult: firstResult,
      selectedFilePath: 'C:\\Paks\\pakchunk1-Windows.pak',
    });
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Details' }).textContent).toBe('Details');
      expect(screen.getByTestId('analysis-tabs')).toHaveAttribute('data-selected-package-id', '');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select package detail' }));
    expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent(
      '../../../Engine/Config/Base.ini',
    );

    mockHarness.state = createMockState({
      analysisResult: {
        overview: { packageCount: 1 },
        packages: [{ packagePath: '../../../Game/Config/Default.ini', order: 1 }],
      },
      selectedFilePath: 'C:\\Paks\\pakchunk1-Windows.pak',
    });
    rerender(<App />);

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Details' }).textContent).toBe('Details');
      expect(screen.getByTestId('analysis-tabs')).toHaveAttribute('data-selected-package-id', '');
    });
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

  test('sizes and drags the opened containers pane without persisting width', () => {
    setViewportWidth(1440);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const deepPackagePath = 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows\\Project\\Content\\Paks\\pakchunk0-WindowsNoEditor_Optional_StreamedTextures_VeryLongLabel.pak';

    mockHarness.state = createMockState({
      scan: {
        root: 'C:\\WORKSPACE_RA\\RATrunk\\LocalBuilds\\Game\\Windows',
        files: [{ path: deepPackagePath, kind: 'pak' }],
        tree: {
          name: 'Windows',
          kind: 'directory',
          children: [
            {
              name: 'Project',
              kind: 'directory',
              children: [
                {
                  name: 'Content',
                  kind: 'directory',
                  children: [
                    {
                      name: 'Paks',
                      kind: 'directory',
                      children: [
                        {
                          name: 'pakchunk0-WindowsNoEditor_Optional_StreamedTextures_VeryLongLabel.pak',
                          path: deepPackagePath,
                          kind: 'pak',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    try {
      const { container } = render(<App />);
      const panels = container.querySelector('.workspace-panels') as HTMLElement;

      expect(openedPaneStyleWidth(container)).toBeGreaterThan(304);
      expect(panels.style.gridTemplateColumns).toBe('');

      const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

      fireEvent.pointerDown(separator, { clientX: 576, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 360, pointerId: 1 });

      expect(openedPaneStyleWidth(container)).toBe(336);

      fireEvent.pointerMove(window, { clientX: 1000, pointerId: 1 });

      expect(openedPaneStyleWidth(container)).toBe(576);

      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });

      expect(openedPaneStyleWidth(container)).toBe(576);
      expect(setItemSpy).not.toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  test('resizes the opened containers pane from the separator keyboard controls', () => {
    setViewportWidth(1440);
    const { container } = render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

    expect(separator).toHaveAttribute('aria-valuemax', '576');
    expect(openedPaneStyleWidth(container)).toBe(304);

    fireEvent.keyDown(separator, { key: 'ArrowRight' });

    expect(openedPaneStyleWidth(container)).toBe(320);
    expect(separator).toHaveAttribute('aria-valuenow', '320');

    fireEvent.keyDown(separator, { key: 'Home' });

    expect(openedPaneStyleWidth(container)).toBe(236);

    fireEvent.keyDown(separator, { key: 'End' });

    expect(openedPaneStyleWidth(container)).toBe(576);
  });

  test('clamps separator keyboard max to the compact visual max', () => {
    setViewportWidth(1024);
    const { container } = render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

    expect(separator).toHaveAttribute('aria-valuemax', '260');

    fireEvent.keyDown(separator, { key: 'Home' });

    expect(openedPaneStyleWidth(container)).toBe(236);

    fireEvent.keyDown(separator, { key: 'End' });

    expect(openedPaneStyleWidth(container)).toBe(260);
    expect(separator).toHaveAttribute('aria-valuenow', '260');
  });

  test('clamps pointer dragging to the compact visual max', () => {
    setViewportWidth(1024);
    const { container } = render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

    fireEvent.pointerDown(separator, { clientX: 576, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1000, pointerId: 1 });

    expect(openedPaneStyleWidth(container)).toBe(260);
    expect(separator).toHaveAttribute('aria-valuenow', '260');
  });

  test('stops drag resizing when the pointer drag is canceled', () => {
    setViewportWidth(1440);
    const { container } = render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

    fireEvent.pointerDown(separator, { clientX: 576, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 360, pointerId: 1 });

    expect(openedPaneStyleWidth(container)).toBe(336);

    fireEvent.pointerCancel(window, { pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1000, pointerId: 1 });

    expect(openedPaneStyleWidth(container)).toBe(336);
  });

  test('stops drag resizing when the window loses focus', () => {
    setViewportWidth(1440);
    const { container } = render(<App />);
    const separator = screen.getByRole('separator', { name: 'Resize opened containers' });

    fireEvent.pointerDown(separator, { clientX: 576, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 360, pointerId: 1 });

    expect(openedPaneStyleWidth(container)).toBe(336);

    fireEvent.blur(window);
    fireEvent.pointerMove(window, { clientX: 1000, pointerId: 1 });

    expect(openedPaneStyleWidth(container)).toBe(336);
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
    expect(screen.getByRole('region', { name: 'Details' }).textContent).toBe('Details');
  });
});
