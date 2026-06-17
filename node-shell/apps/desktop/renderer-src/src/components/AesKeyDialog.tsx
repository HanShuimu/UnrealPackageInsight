import { Form, Input, Modal } from 'antd';
import { useCallback, useEffect, useState } from 'react';

type AesKeyDialogProps = {
  open: boolean;
  message: string;
  loading: boolean;
  onSubmit(aesKey: string): void;
  onCancel(): void;
};

export function AesKeyDialog({ open, message, loading, onSubmit, onCancel }: AesKeyDialogProps) {
  const [aesKey, setAesKey] = useState('');

  useEffect(() => {
    if (!open) {
      setAesKey('');
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    onSubmit(aesKey);
  }, [aesKey, onSubmit]);

  return (
    <Modal
      confirmLoading={loading}
      okText="Submit"
      open={open}
      title="AES key required"
      onCancel={onCancel}
      onOk={handleSubmit}
    >
      {message ? <p>{message}</p> : null}
      <Form layout="vertical">
        <Form.Item label="AES key">
          <Input.Password
            autoFocus
            value={aesKey}
            onChange={(event) => setAesKey(event.target.value)}
            onPressEnter={handleSubmit}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
