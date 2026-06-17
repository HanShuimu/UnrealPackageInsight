import { Button, Layout, Spin, Typography } from 'antd';
import { useCallback, useEffect, useState, type RefCallback } from 'react';
import { AesKeyDialog } from './components/AesKeyDialog';
import { AnalysisTabs } from './components/AnalysisTabs';
import { BackendChooserDialog } from './components/BackendChooserDialog';
import { PackageTree } from './components/PackageTree';
import { useAppStore } from './stores/useAppStore';
import type { BackendInfo } from './types/upi';

const { Content, Header, Sider } = Layout;

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

  const name = backendInfo.backendName || 'Unknown backend';
  const version = backendInfo.backendVersion ? ` ${backendInfo.backendVersion}` : '';
  const unrealVersion = backendInfo.unrealVersion ? ` / UE ${backendInfo.unrealVersion}` : '';

  return `${name}${version}${unrealVersion}`;
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

  useEffect(() => {
    void loadBackendInfo();
  }, [loadBackendInfo]);

  const backendText = backendLabel(backendInfo);
  const selectedLabel = selectedFilePath || 'None';
  const shellBusy = isOpeningDirectory || isAnalyzing;

  return (
    <Layout className="app-shell">
      <Header className="shell-toolbar">
        <div className="toolbar-primary">
          <Typography.Title className="app-title" level={5}>
            UnrealPackageInsight
          </Typography.Title>
          <Button
            loading={isOpeningDirectory}
            type="primary"
            onClick={() => void openDirectory()}
          >
            Open
          </Button>
        </div>
        <div className="toolbar-status" aria-live="polite">
          <span className="status-item">
            <Typography.Text className="status-label">Status</Typography.Text>
            <Typography.Text
              aria-label={`Status: ${statusText}`}
              className="status-value"
              strong
              title={statusText}
            >
              {statusText}
            </Typography.Text>
          </span>
          <span className="status-item">
            <Typography.Text className="status-label">Backend</Typography.Text>
            <Typography.Text
              aria-label={`Backend: ${backendText}`}
              className="status-value"
              ellipsis
              title={backendText}
            >
              {backendText}
            </Typography.Text>
          </span>
        </div>
      </Header>

      <Layout className="shell-body">
        <Sider className="app-sidebar" theme="light" width={328}>
          <section className="tree-region" aria-label="Package files">
            <div className="pane-header">
              <Typography.Text strong>Packages</Typography.Text>
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
        </Sider>

        <Content className="analysis-content">
          <section className="analysis-header" aria-label="Analysis status">
            <div className="analysis-title">
              <Typography.Text className="status-label">Selected</Typography.Text>
              <Typography.Text
                aria-label={`Selected file: ${selectedLabel}`}
                className="selected-value"
                ellipsis
                strong
                title={selectedLabel}
              >
                {selectedLabel}
              </Typography.Text>
            </div>
            <Spin spinning={shellBusy} size="small" />
          </section>
          <Spin classNames={{ root: 'analysis-spinner' }} spinning={shellBusy}>
            <div className="analysis-tabs-region" ref={analysisTabsRegionRef}>
              <AnalysisTabs result={analysisResult} tableHeight={tableHeight} />
            </div>
          </Spin>
        </Content>
      </Layout>

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
