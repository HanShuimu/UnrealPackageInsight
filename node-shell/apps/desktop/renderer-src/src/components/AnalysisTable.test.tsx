import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AnalysisTable } from './AnalysisTable';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Table: (props: { virtual?: boolean; scroll?: { x?: number; y?: number }; dataSource?: unknown[] }) => (
      <div
        data-testid="mock-table"
        data-virtual={String(props.virtual)}
        data-scroll-x={String(props.scroll?.x)}
        data-scroll-y={String(props.scroll?.y)}
        data-row-count={String(props.dataSource?.length || 0)}
      />
    ),
  };
});

describe('AnalysisTable', () => {
  test('uses Ant Design virtual table scrolling with numeric scroll dimensions', () => {
    render(<AnalysisTable rows={[{ name: 'A' }, { name: 'B' }]} height={420} />);

    const table = screen.getByTestId('mock-table');
    expect(table).toHaveAttribute('data-virtual', 'true');
    expect(table).toHaveAttribute('data-scroll-y', '420');
    expect(Number(table.getAttribute('data-scroll-x'))).toBeGreaterThan(0);
    expect(table).toHaveAttribute('data-row-count', '2');
  });
});
