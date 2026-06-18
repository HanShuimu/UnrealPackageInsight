import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AnalysisTabs } from './AnalysisTabs';

type ObserverRecord = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

const resizeHarness = vi.hoisted(() => ({
  observers: [] as ObserverRecord[],
}));

class ResizeObserverMock implements ResizeObserver {
  private readonly record: ObserverRecord;

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: new Set<Element>() };
    resizeHarness.observers.push(this.record);
  }

  disconnect(): void {
    this.record.targets.clear();
  }

  observe(target: Element): void {
    this.record.targets.add(target);
  }

  unobserve(target: Element): void {
    this.record.targets.delete(target);
  }
}

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

function resizeElement(selector: string, height: number): void {
  const targets = Array.from(document.querySelectorAll(selector));

  if (targets.length === 0) {
    throw new Error(`Missing element for selector: ${selector}`);
  }

  act(() => {
    resizeHarness.observers.forEach((observer) => {
      const entries = targets
        .filter((target) => observer.targets.has(target))
        .map((target) => ({
          contentRect: { height },
          target,
        } as ResizeObserverEntry));

      if (entries.length > 0) {
        observer.callback(entries, {} as ResizeObserver);
      }
    });
  });
}

describe('AnalysisTabs', () => {
  beforeEach(() => {
    resizeHarness.observers.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  test('renders IoStore partitions and uses fallback height before pane measurement', () => {
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
      expect(table).toHaveAttribute('data-height', '285');
    });
  });

  test('sizes virtual tables from the tab content pane instead of the outer tabs region', async () => {
    render(
      <AnalysisTabs
        tableHeight={500}
        result={{
          packages: [{ name: 'A' }],
          compressedBlocks: [],
          issues: [],
        }}
      />,
    );

    resizeElement('.analysis-table-pane', 360);

    await waitFor(() => {
      screen.getAllByTestId('analysis-table').forEach((table) => {
        expect(table).toHaveAttribute('data-height', '312');
      });
    });
  });
});
