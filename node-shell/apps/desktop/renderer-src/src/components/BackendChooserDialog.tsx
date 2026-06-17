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
      okButtonProps={{ disabled: !selectedId }}
      okText="Use backend"
      open={Boolean(request)}
      title="Choose backend"
      onCancel={onCancel}
      onOk={handleSubmit}
    >
      <p>{request?.containerLabel || 'Container'} requires a backend.</p>
      {candidates.length > 0 ? (
        <Radio.Group
          options={options}
          value={selectedId}
          onChange={(event) => setSelectedId(String(event.target.value))}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No backend candidates available." />
      )}
    </Modal>
  );
}
