import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AnalysisTabs } from './AnalysisTabs';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');

  type TabItem = {
    children?: React.ReactNode;
    key: string;
    label: React.ReactNode;
  };

  return {
    ...actual,
    Descriptions: ({ items }: { items?: Array<{ key: string; label: string; children: React.ReactNode }> }) => (
      <dl>
        {items?.map((item) => (
          <React.Fragment key={item.key}>
            <dt>{item.label}</dt>
            <dd>{item.children}</dd>
          </React.Fragment>
        ))}
      </dl>
    ),
    Empty: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Tabs: ({ items }: { items?: TabItem[] }) => (
      <div>
        {items?.map((item) => (
          <section data-tab-key={item.key} key={item.key}>
            <h2>{item.label}</h2>
            {item.children}
          </section>
        ))}
      </div>
    ),
    Typography: {
      Paragraph: ({ children }: { children?: React.ReactNode }) => <pre>{children}</pre>,
    },
  };
});

vi.mock('./AnalysisTable', () => ({
  AnalysisTable: ({ height, rows }: { height: number; rows: unknown[] }) => (
    <div data-testid="analysis-table" data-height={height} data-row-count={rows.length} />
  ),
}));

describe('AnalysisTabs', () => {
  test('renders IoStore partitions and passes tableHeight to table tabs', () => {
    const { container } = render(
      <AnalysisTabs
        tableHeight={333}
        result={{
          chunks: [],
          packages: [],
          compressedBlocks: [],
          partitions: [{ id: 1, name: 'Partition 0' }],
          issues: [],
        }}
      />,
    );

    expect(screen.getByText('Partitions')).toBeInTheDocument();
    expect(container.querySelector('[data-tab-key="partitions"] [data-testid="analysis-table"]'))
      .toHaveAttribute('data-row-count', '1');
    screen.getAllByTestId('analysis-table').forEach((table) => {
      expect(table).toHaveAttribute('data-height', '333');
    });
  });
});
