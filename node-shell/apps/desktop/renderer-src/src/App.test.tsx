import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import App from './App';

class ResizeObserverMock implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

vi.mock('./stores/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    backendInfo: { backendName: 'TestBackend', backendVersion: '1.0' },
    scan: null,
    selectedFilePath: '',
    analysisResult: null,
    statusText: 'Ready',
    isOpeningDirectory: false,
    isAnalyzing: false,
    dialog: { aesFilePath: '', aesMessage: '', backendSelection: null },
    loadBackendInfo: vi.fn(),
    openDirectory: vi.fn(),
    analyzeFile: vi.fn(),
    submitAesKey: vi.fn(),
    cancelAesDialog: vi.fn(),
    chooseBackend: vi.fn(),
    cancelBackendDialog: vi.fn(),
  }),
}));

describe('App', () => {
  test('renders the desktop shell regions', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/TestBackend/)).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
