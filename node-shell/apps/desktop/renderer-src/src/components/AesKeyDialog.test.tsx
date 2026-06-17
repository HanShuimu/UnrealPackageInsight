import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AesKeyDialog } from './AesKeyDialog';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  type ModalProps = {
    children?: React.ReactNode;
    confirmLoading?: boolean;
    okButtonProps?: { disabled?: boolean };
    okText?: string;
    open?: boolean;
    onCancel?: () => void;
    onOk?: () => void;
  };

  type PasswordProps = {
    autoComplete?: string;
    disabled?: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    onPressEnter?: React.KeyboardEventHandler<HTMLInputElement>;
    spellCheck?: boolean;
    value?: string;
  };

  const Form = ({ children }: { children?: React.ReactNode }) => <form>{children}</form>;
  Form.Item = ({ children }: { children?: React.ReactNode; label?: string }) => <>{children}</>;

  return {
    ...actual,
    Form,
    Input: {
      Password: (props: PasswordProps) => (
        <input
          aria-label="AES key"
          autoComplete={props.autoComplete}
          disabled={props.disabled}
          spellCheck={props.spellCheck}
          type="password"
          value={props.value}
          onChange={props.onChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              props.onPressEnter?.(event);
            }
          }}
        />
      ),
    },
    Modal: (props: ModalProps) => (
      props.open ? (
        <div>
          <button type="button" onClick={props.onCancel}>Cancel</button>
          <button
            type="button"
            disabled={props.okButtonProps?.disabled || props.confirmLoading}
            onClick={props.onOk}
          >
            {props.okText}
          </button>
          {props.children}
        </div>
      ) : null
    ),
  };
});

describe('AesKeyDialog', () => {
  test('prevents submit while loading and disables password entry', () => {
    const onSubmit = vi.fn();

    render(
      <AesKeyDialog
        loading
        message="Needs a key."
        open
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByLabelText('AES key');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');

    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('submits the entered AES key when not loading', () => {
    const onSubmit = vi.fn();

    render(
      <AesKeyDialog
        loading={false}
        message="Needs a key."
        open
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByLabelText('AES key');
    fireEvent.change(input, { target: { value: '0x1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    expect(onSubmit).toHaveBeenCalledWith('0x1234');
  });
});
