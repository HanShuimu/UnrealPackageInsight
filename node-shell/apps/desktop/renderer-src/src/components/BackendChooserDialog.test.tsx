import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { BackendSelectionRequest } from '../types/upi';
import { BackendChooserDialog } from './BackendChooserDialog';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  type ModalProps = {
    children?: React.ReactNode;
    okButtonProps?: { disabled?: boolean };
    okText?: string;
    open?: boolean;
    title?: React.ReactNode;
    onCancel?: () => void;
    onOk?: () => void;
  };

  type RadioOption = {
    label: React.ReactNode;
    value: string;
  };

  type RadioGroupProps = {
    options?: RadioOption[];
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
  };

  return {
    ...actual,
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Modal: (props: ModalProps) => (
      props.open ? (
        <div>
          <h1>{props.title}</h1>
          <button type="button" onClick={props.onCancel}>Cancel</button>
          <button type="button" disabled={props.okButtonProps?.disabled} onClick={props.onOk}>
            {props.okText}
          </button>
          {props.children}
        </div>
      ) : null
    ),
    Radio: {
      Group: (props: RadioGroupProps) => (
        <div>
          {props.options?.map((option) => (
            <label key={option.value}>
              <input
                checked={props.value === option.value}
                name="backend"
                type="radio"
                value={option.value}
                onChange={() => props.onChange?.({ target: { value: option.value } })}
              />
              {option.label}
            </label>
          ))}
        </div>
      ),
    },
  };
});

const request: BackendSelectionRequest = {
  containerLabel: 'Global.utoc',
  filePath: 'C:\\WORKSPACE_UE\\UnrealPackageInsight\\ue-backend',
  probe: { platform: 'Win64' },
  candidates: [
    { id: 'ue57', label: 'Unreal 5.7' },
    { id: 'legacy', label: 'Legacy backend' },
  ],
};

describe('BackendChooserDialog', () => {
  test('shows UPI Final backend selector layout and backend ids in option labels', () => {
    const onSubmit = vi.fn();

    render(<BackendChooserDialog request={request} onCancel={() => {}} onSubmit={onSubmit} />);

    expect(screen.getByRole('heading', { name: 'Select Backend' })).toBeInTheDocument();
    expect(screen.getByText('Backend root')).toBeInTheDocument();
    expect(screen.getByText('C:\\WORKSPACE_UE\\UnrealPackageInsight\\ue-backend')).toBeInTheDocument();
    expect(screen.getByText('Current platform')).toBeInTheDocument();
    expect(screen.getByText('Win64')).toBeInTheDocument();
    expect(screen.getByText('Available backends')).toBeInTheDocument();
    expect(screen.getByLabelText('Unreal 5.7 (ue57)')).toBeChecked();
    expect(screen.getByLabelText('Legacy backend (legacy)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));

    expect(onSubmit).toHaveBeenCalledWith('ue57');
  });

  test('renders an empty state and does not submit when candidates are missing', () => {
    const onSubmit = vi.fn();

    render(
      <BackendChooserDialog
        request={{ candidates: [] }}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Select Backend' })).toBeInTheDocument();
    expect(screen.getByText('No backend candidates available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use selected' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
