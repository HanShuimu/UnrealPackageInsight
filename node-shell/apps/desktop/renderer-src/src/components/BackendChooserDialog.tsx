import { Modal, Radio } from 'antd';
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
      label: candidate.label,
      value: candidate.id,
    }))
  ), [candidates]);

  const handleSubmit = useCallback(() => {
    onSubmit(selectedId);
  }, [onSubmit, selectedId]);

  return (
    <Modal
      okText="Use backend"
      open={Boolean(request)}
      title="Choose backend"
      onCancel={onCancel}
      onOk={handleSubmit}
    >
      <Radio.Group
        options={options}
        value={selectedId}
        onChange={(event) => setSelectedId(String(event.target.value))}
      />
    </Modal>
  );
}
