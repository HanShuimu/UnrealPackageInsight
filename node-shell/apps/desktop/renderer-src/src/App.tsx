import { Button, Layout, Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { AesKeyDialog } from './components/AesKeyDialog';
import { AnalysisTabs } from './components/AnalysisTabs';
import { BackendChooserDialog } from './components/BackendChooserDialog';
import { PackageTree } from './components/PackageTree';
import { useAppStore } from './stores/useAppStore';
import type { BackendInfo } from './types/upi';

const { Content, Header, Sider } = Layout;

const TOOLBAR_HEIGHT = 48;
const TREE_CHROME_HEIGHT = 52;
const ANALYSIS_CHROME_HEIGHT = 104;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const MIN_TREE_HEIGHT = 240;
const MIN_TABLE_HEIGHT = 280;

function viewportHeight(): number {
  return typeof window === 'undefined' ? DEFAULT_VIEWPORT_HEIGHT : window.innerHeight;
}

function useViewportHeight(): number {
  const [height, setHeight] = useState(viewportHeight);

  useEffect(() => {
    const handleResize = () => setHeight(viewportHeight());

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return height;
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
  const height = useViewportHeight();

  useEffect(() => {
    void loadBackendInfo();
  }, [loadBackendInfo]);

  const layoutHeights = useMemo(() => ({
    tableHeight: Math.max(MIN_TABLE_HEIGHT, height - ANALYSIS_CHROME_HEIGHT),
    treeHeight: Math.max(MIN_TREE_HEIGHT, height - TOOLBAR_HEIGHT - TREE_CHROME_HEIGHT),
  }), [height]);

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
            <Typography.Text strong>{statusText}</Typography.Text>
          </span>
          <span className="status-item">
            <Typography.Text className="status-label">Backend</Typography.Text>
            <Typography.Text ellipsis title={backendLabel(backendInfo)}>
              {backendLabel(backendInfo)}
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
            <div className="tree-content">
              <PackageTree
                height={layoutHeights.treeHeight}
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
              <Typography.Text ellipsis strong title={selectedLabel}>
                {selectedLabel}
              </Typography.Text>
            </div>
            <Spin spinning={shellBusy} size="small" />
          </section>
          <Spin classNames={{ root: 'analysis-spinner' }} spinning={shellBusy}>
            <div className="analysis-tabs-region">
              <AnalysisTabs result={analysisResult} tableHeight={layoutHeights.tableHeight} />
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
