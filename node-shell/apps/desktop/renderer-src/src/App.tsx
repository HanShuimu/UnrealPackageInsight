import { Button, Layout, Spin, Typography } from 'antd';
import { useCallback, useEffect, useState, type RefCallback } from 'react';
import { AesKeyDialog } from './components/AesKeyDialog';
import { AnalysisTabs } from './components/AnalysisTabs';
import { BackendChooserDialog } from './components/BackendChooserDialog';
import { PackageTree } from './components/PackageTree';
import { useAppStore } from './stores/useAppStore';
import type { BackendInfo } from './types/upi';
import type { DetailSelection } from './utils/analysisViewModel';

const { Header } = Layout;

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

function backendLabel(backendInfo: BackendInfo | null): string {
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

function backendPillLabel(backendInfo: BackendInfo | null, fallback: string): string {
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

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || filePath;
}

function selectedKindLabel(filePath: string): string {
  const lowerPath = filePath.toLowerCase();

  if (lowerPath.endsWith('.pak')) {
    return 'Pak';
  }

  if (lowerPath.endsWith('.utoc') || lowerPath.endsWith('.ucas')) {
    return 'IoStore';
  }

  return 'Container';
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
  const chooseBackend = useAppStore((state) => state.chooseBackend);
  const cancelBackendDialog = useAppStore((state) => state.cancelBackendDialog);
  const [treeContentRef, treeHeight] = useMeasuredHeight<HTMLDivElement>();
  const [analysisTabsRegionRef, tableHeight] = useMeasuredHeight<HTMLDivElement>();
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);

  useEffect(() => {
    void loadBackendInfo();
  }, [loadBackendInfo]);

  const backendText = backendLabel(backendInfo);
  const backendPillText = backendPillLabel(backendInfo, backendText);
  const packageRootLabel = scan?.root || 'No package directory opened';
  const selectedLabel = selectedFilePath ? fileName(selectedFilePath) : '';
  const selectedKind = selectedFilePath ? selectedKindLabel(selectedFilePath) : '';
  const selectedPackageId = detailSelection?.kind === 'package' ? detailSelection.row.id : '';
  const shellBusy = isOpeningDirectory || isAnalyzing;

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
        <div className="workspace-panels">
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

          <section className="workspace-pane details-region" aria-label="Details">
            <div className="pane-title-block">
              <div>
                <Typography.Title className="pane-title" level={2}>
                  Details
                </Typography.Title>
                <Typography.Text className="pane-subtitle">
                  {selectedFilePath ? 'Selected resource' : 'Selection-specific region'}
                </Typography.Text>
              </div>
            </div>
            <div className="detail-stack">
              <div className={`detail-card${selectedLabel ? ' has-content' : ''}`}>
                {selectedLabel ? (
                  <>
                    <Typography.Text className="detail-label">File</Typography.Text>
                    <Typography.Text
                      aria-label={`Selected file: ${selectedFilePath}`}
                      className="detail-value selected-value"
                      ellipsis
                      title={selectedFilePath}
                    >
                      {selectedLabel}
                    </Typography.Text>
                  </>
                ) : null}
              </div>
              <div className={`detail-card${analysisResult ? ' has-content' : ''}`}>
                {analysisResult ? (
                  <>
                    <Typography.Text className="detail-label">Analysis</Typography.Text>
                    <Typography.Text className="detail-value" ellipsis title={statusText}>
                      {statusText}
                    </Typography.Text>
                  </>
                ) : null}
              </div>
              <div className="detail-card" />
            </div>
            {selectedKind ? (
              <div className="details-footer">
                <Typography.Text className="container-kind-pill" strong>{selectedKind}</Typography.Text>
              </div>
            ) : null}
          </section>
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
