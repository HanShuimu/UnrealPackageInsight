import { Button, Layout, Spin, Typography } from 'antd';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefCallback,
} from 'react';
import { AesKeyDialog } from './components/AesKeyDialog';
import { AnalysisTabs } from './components/AnalysisTabs';
import { BackendChooserDialog } from './components/BackendChooserDialog';
import { DetailsPane } from './components/DetailsPane';
import { PackageTree } from './components/PackageTree';
import { useAppStore } from './stores/useAppStore';
import type { AnalysisResult, BackendInfo } from './types/upi';
import type { DetailSelection } from './utils/analysisViewModel';
import {
  OPENED_CONTAINERS_MAX_WIDTH,
  OPENED_CONTAINERS_MIN_WIDTH,
  clampOpenedContainersWidth,
  estimateOpenedContainersWidth,
} from './utils/openedContainersPane';

const { Header } = Layout;
const SHELL_HORIZONTAL_PADDING = 24;
const OPENED_PANE_KEYBOARD_STEP = 16;
const OPENED_PANE_COMPACT_BREAKPOINT = 1040;
const OPENED_PANE_COMPACT_MAX_WIDTH = 260;

type OpenedPaneStyle = CSSProperties & {
  '--opened-pane-width': string;
};

function getViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 1440;
  }

  return window.innerWidth || 1440;
}

function openedPaneStyle(width: number): OpenedPaneStyle {
  return { '--opened-pane-width': `${width}px` };
}

function openedPaneMaxWidthForViewport(viewportWidth: number): number {
  if (viewportWidth <= OPENED_PANE_COMPACT_BREAKPOINT) {
    return OPENED_PANE_COMPACT_MAX_WIDTH;
  }

  return clampOpenedContainersWidth(OPENED_CONTAINERS_MAX_WIDTH, viewportWidth);
}

function clampOpenedPaneWidthForViewport(width: number, viewportWidth: number): number {
  return Math.min(
    openedPaneMaxWidthForViewport(viewportWidth),
    clampOpenedContainersWidth(width, viewportWidth),
  );
}

function openedPaneMaxWidth(): number {
  return openedPaneMaxWidthForViewport(getViewportWidth());
}

function normalizeMeasuredHeight(height: number): number {
  return Math.max(0, Math.floor(height));
}

function readElementHeight(element: HTMLElement): number {
  return element.getBoundingClientRect().height || element.clientHeight || 0;
}

function useMeasuredHeight<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [element, setElement] = useState<T | null>(null);
  const [height, setHeight] = useState(0);

  const ref = useCallback((nextElement: T | null) => {
    setElement(nextElement);
  }, []);

  useEffect(() => {
    if (!element) {
      setHeight(0);
      return undefined;
    }

    const updateHeight = (nextHeight: number) => {
      const measuredHeight = normalizeMeasuredHeight(nextHeight);
      setHeight((currentHeight) => (
        currentHeight === measuredHeight ? currentHeight : measuredHeight
      ));
    };

    updateHeight(readElementHeight(element));

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateHeight(entry?.contentRect.height ?? readElementHeight(element));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return [ref, height];
}

function currentBackendId(result: AnalysisResult | null): string {
  return typeof result?.backendId === 'string' && result.backendId.trim() !== ''
    ? result.backendId.trim()
    : '';
}

function backendInfoById(backendInfo: BackendInfo | null, backendId: string) {
  return backendInfo?.backends?.find((backend) => backend.id === backendId) ?? null;
}

function backendFullLabel(backend: { id?: string; label: string }): string {
  return backend.id ? `${backend.label} (${backend.id})` : backend.label;
}

function backendLabel(backendInfo: BackendInfo | null, result: AnalysisResult | null): string {
  const backendId = currentBackendId(result);
  if (backendId) {
    const backend = backendInfoById(backendInfo, backendId);
    return backend ? backendFullLabel(backend) : backendId;
  }

  if (!backendInfo) {
    return 'Not loaded';
  }

  const details = [
    backendInfo.backendName,
    backendInfo.backendVersion ? `v${backendInfo.backendVersion}` : '',
    backendInfo.unrealVersion ? `UE ${backendInfo.unrealVersion}` : '',
    backendInfo.protocolVersion ? `protocol ${backendInfo.protocolVersion}` : '',
  ].filter(Boolean);

  if (details.length > 0) {
    return details.join(' | ');
  }

  if (Array.isArray(backendInfo.backends) && backendInfo.backends.length === 1) {
    const backend = backendInfo.backends[0];
    return backend.id ? `${backend.label} (${backend.id})` : backend.label;
  }

  if (typeof backendInfo.backendCount === 'number') {
    if (backendInfo.backendCount === 0) {
      return 'No backends available';
    }

    return backendInfo.backendCount === 1
      ? '1 backend available'
      : `${backendInfo.backendCount} backends available`;
  }

  if (Array.isArray(backendInfo.issues) && backendInfo.issues.length > 0) {
    return 'Issue reported';
  }

  return 'Ready';
}

function backendPillLabel(
  backendInfo: BackendInfo | null,
  result: AnalysisResult | null,
  fallback: string,
): string {
  const backendId = currentBackendId(result);
  if (backendId) {
    return backendInfoById(backendInfo, backendId)?.label ?? backendId;
  }

  if (!backendInfo) {
    return fallback;
  }

  if (backendInfo.unrealVersion) {
    return `UE ${backendInfo.unrealVersion}`;
  }

  if (Array.isArray(backendInfo.backends) && backendInfo.backends.length > 0) {
    return backendInfo.backends[0].label;
  }

  if (backendInfo.backendName) {
    return backendInfo.backendName;
  }

  return fallback;
}

export default function App() {
  const backendInfo = useAppStore((state) => state.backendInfo);
  const scan = useAppStore((state) => state.scan);
  const selectedFilePath = useAppStore((state) => state.selectedFilePath);
  const analysisResult = useAppStore((state) => state.analysisResult);
  const statusText = useAppStore((state) => state.statusText);
  const isOpeningDirectory = useAppStore((state) => state.isOpeningDirectory);
  const isAnalyzing = useAppStore((state) => state.isAnalyzing);
  const dialog = useAppStore((state) => state.dialog);
  const loadBackendInfo = useAppStore((state) => state.loadBackendInfo);
  const openDirectory = useAppStore((state) => state.openDirectory);
  const analyzeFile = useAppStore((state) => state.analyzeFile);
  const submitAesKey = useAppStore((state) => state.submitAesKey);
  const cancelAesDialog = useAppStore((state) => state.cancelAesDialog);
  const openBackendSelection = useAppStore((state) => state.openBackendSelection);
  const chooseBackend = useAppStore((state) => state.chooseBackend);
  const cancelBackendDialog = useAppStore((state) => state.cancelBackendDialog);
  const [treeContentRef, treeHeight] = useMeasuredHeight<HTMLDivElement>();
  const [analysisTabsRegionRef, tableHeight] = useMeasuredHeight<HTMLDivElement>();
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const [viewportWidth, setViewportWidthState] = useState(getViewportWidth);
  const [openedPaneWidth, setOpenedPaneWidth] = useState(() => {
    const currentViewportWidth = getViewportWidth();
    return clampOpenedPaneWidthForViewport(
      estimateOpenedContainersWidth(scan?.tree, currentViewportWidth),
      currentViewportWidth,
    );
  });
  const openedPaneDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void loadBackendInfo();
  }, [loadBackendInfo]);

  useEffect(() => {
    setDetailSelection(null);
  }, [analysisResult, selectedFilePath]);

  useEffect(() => {
    const viewportWidth = getViewportWidth();
    setOpenedPaneWidth(clampOpenedPaneWidthForViewport(
      estimateOpenedContainersWidth(scan?.tree, viewportWidth),
      viewportWidth,
    ));
  }, [scan?.tree]);

  useEffect(() => {
    function handleViewportResize(): void {
      const nextViewportWidth = getViewportWidth();
      setViewportWidthState(nextViewportWidth);
      setOpenedPaneWidth((currentWidth) => (
        clampOpenedPaneWidthForViewport(currentWidth, nextViewportWidth)
      ));
    }

    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  useEffect(() => () => {
    openedPaneDragCleanupRef.current?.();
  }, []);

  const handleOpenedPanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    openedPaneDragCleanupRef.current?.();

    const updateWidth = (clientX: number) => {
      setOpenedPaneWidth(clampOpenedPaneWidthForViewport(
        clientX - SHELL_HORIZONTAL_PADDING,
        getViewportWidth(),
      ));
    };

    function handlePointerMove(moveEvent: PointerEvent): void {
      updateWidth(moveEvent.clientX);
    }

    function removeDragListeners(): void {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      openedPaneDragCleanupRef.current = null;
    }

    function handlePointerUp(): void {
      removeDragListeners();
    }

    function handlePointerCancel(): void {
      removeDragListeners();
    }

    function handleWindowBlur(): void {
      removeDragListeners();
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    openedPaneDragCleanupRef.current = removeDragListeners;
  }, []);

  const handleOpenedPaneKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setOpenedPaneWidth((currentWidth) => clampOpenedPaneWidthForViewport(
        currentWidth - OPENED_PANE_KEYBOARD_STEP,
        getViewportWidth(),
      ));
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setOpenedPaneWidth((currentWidth) => clampOpenedPaneWidthForViewport(
        currentWidth + OPENED_PANE_KEYBOARD_STEP,
        getViewportWidth(),
      ));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setOpenedPaneWidth(OPENED_CONTAINERS_MIN_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setOpenedPaneWidth(openedPaneMaxWidth());
    }
  }, []);

  const backendText = backendLabel(backendInfo, analysisResult);
  const backendPillText = backendPillLabel(backendInfo, analysisResult, backendText);
  const packageRootLabel = scan?.root || 'No package directory opened';
  const selectedPackageId = detailSelection?.kind === 'package' ? detailSelection.row.id : '';
  const shellBusy = isOpeningDirectory || isAnalyzing;
  const openedPaneMaxWidthValue = openedPaneMaxWidthForViewport(viewportWidth);

  return (
    <Layout className="app-shell">
      <Header className="shell-toolbar">
        <div
          aria-label="Package root"
          className="package-root-field"
          title={packageRootLabel}
        >
          {packageRootLabel}
        </div>
        <div className="toolbar-actions" aria-live="polite">
          <Button
            className="toolbar-button"
            loading={isOpeningDirectory}
            onClick={() => void openDirectory()}
          >
            Open
          </Button>
          <Button
            className="toolbar-button backend-toolbar-button"
            onClick={() => void openBackendSelection()}
            title={dialog.backendSelection ? 'Backend selection is open' : backendText}
            type={dialog.backendSelection ? 'primary' : 'default'}
          >
            Backend
          </Button>
          <Typography.Text
            aria-label={`Backend: ${backendText}`}
            className="backend-pill status-value"
            ellipsis
            title={backendText}
          >
            {backendPillText}
          </Typography.Text>
          <Typography.Text
            aria-label={`Status: ${statusText}`}
            className="status-pill status-value"
            strong
            title={statusText}
          >
            {statusText}
          </Typography.Text>
        </div>
      </Header>

      <div className="shell-body">
        <div className="workspace-panels" style={openedPaneStyle(openedPaneWidth)}>
          <section className="workspace-pane opened-containers-pane" aria-label="Package files">
            <div className="pane-title-block">
              <div>
                <Typography.Title className="pane-title" level={2}>
                  Opened containers
                </Typography.Title>
                <Typography.Text className="pane-subtitle">Single selected source</Typography.Text>
              </div>
              <Spin spinning={isOpeningDirectory} size="small" />
            </div>
            <div className="tree-content" ref={treeContentRef}>
              <PackageTree
                height={treeHeight}
                scan={scan}
                selectedFilePath={selectedFilePath}
                onSelectFile={(filePath) => void analyzeFile(filePath)}
              />
            </div>
            <div
              aria-label="Resize opened containers"
              aria-orientation="vertical"
              aria-valuemax={openedPaneMaxWidthValue}
              aria-valuemin={OPENED_CONTAINERS_MIN_WIDTH}
              aria-valuenow={openedPaneWidth}
              className="opened-containers-resizer"
              role="separator"
              tabIndex={0}
              onKeyDown={handleOpenedPaneKeyDown}
              onPointerDown={handleOpenedPanePointerDown}
            />
          </section>

          <main className="analysis-content">
            <Spin classNames={{ root: 'analysis-spinner' }} spinning={shellBusy}>
              <div className="analysis-tabs-region" ref={analysisTabsRegionRef}>
                <AnalysisTabs
                  result={analysisResult}
                  selectedPackageId={selectedPackageId}
                  tableHeight={tableHeight}
                  onDetailsSelectionChange={setDetailSelection}
                />
              </div>
            </Spin>
          </main>

          <DetailsPane selection={detailSelection} />
        </div>
      </div>

      <AesKeyDialog
        loading={isAnalyzing}
        message={dialog.aesMessage}
        open={Boolean(dialog.aesFilePath)}
        onCancel={cancelAesDialog}
        onSubmit={(aesKey) => void submitAesKey(aesKey)}
      />
      <BackendChooserDialog
        request={dialog.backendSelection}
        onCancel={cancelBackendDialog}
        onSubmit={(selectedId) => void chooseBackend(selectedId)}
      />
    </Layout>
  );
}
