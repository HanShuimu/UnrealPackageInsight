import { Empty, Modal, Radio } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackendSelectionRequest } from '../types/upi';

type BackendChooserDialogProps = {
  request: BackendSelectionRequest | null;
  onSubmit(selectedId: string): void;
  onCancel(): void;
};

export function BackendChooserDialog({ request, onSubmit, onCancel }: BackendChooserDialogProps) {
  const [selectedId, setSelectedId] = useState('');
  const candidates = request?.candidates ?? [];
  const backendRoot = request?.filePath
    || request?.analysisFilePath
    || request?.containerLabel
    || 'Container';
  const platformLabel = typeof request?.probe?.platform === 'string'
    ? request.probe.platform
    : 'Current';

  useEffect(() => {
    setSelectedId(request?.candidates?.[0]?.id ?? '');
  }, [request]);

  const options = useMemo(() => (
    candidates.map((candidate) => ({
      label: `${candidate.label} (${candidate.id})`,
      value: candidate.id,
    }))
  ), [candidates]);

  const handleSubmit = useCallback(() => {
    if (!selectedId) {
      return;
    }

    onSubmit(selectedId);
  }, [onSubmit, selectedId]);

  return (
    <Modal
      className="backend-selector-modal"
      okButtonProps={{ disabled: !selectedId }}
      okText="Use selected"
      open={Boolean(request)}
      title="Select Backend"
      width={608}
      onCancel={onCancel}
      onOk={handleSubmit}
    >
      <div className="backend-dialog-body">
        <div className="backend-field">
          <span className="backend-field-label">Backend root</span>
          <div className="backend-root-value" title={backendRoot}>{backendRoot}</div>
        </div>
        <div className="backend-platform-row">
          <span className="backend-field-label">Current platform</span>
          <span className="backend-platform-pill">{platformLabel}</span>
        </div>
        <div className="backend-candidates">
          <span className="backend-field-label">Available backends</span>
          {candidates.length > 0 ? (
            <Radio.Group
              className="backend-candidate-list"
              options={options}
              value={selectedId}
              onChange={(event) => setSelectedId(String(event.target.value))}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No backend candidates available." />
          )}
        </div>
      </div>
    </Modal>
  );
}
