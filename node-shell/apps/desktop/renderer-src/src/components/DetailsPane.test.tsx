import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { DetailSelection, IssueRow, PackageRow } from '../utils/analysisViewModel';
import { DetailsPane } from './DetailsPane';

function packageSelection(row: Partial<PackageRow> = {}): DetailSelection {
  return {
    kind: 'package',
    row: {
      id: '../../../Engine/Config/Base.ini',
      fullPath: '../../../Engine/Config/Base.ini',
      fileName: 'Base.ini',
      source: {},
      ...row,
    },
  };
}

function issueSelection(row: Partial<IssueRow> = {}): DetailSelection {
  return {
    kind: 'issue',
    row: {
      id: 'issue-1',
      severity: 'warning',
      code: 'UPI001',
      message: 'Package index is sparse',
      source: {},
      ...row,
    },
  };
}

describe('DetailsPane', () => {
  test('empty state contains only the Details title', () => {
    render(<DetailsPane selection={null} />);

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details.textContent).toBe('Details');
    expect(screen.queryByText('Selection-specific region')).not.toBeInTheDocument();
    expect(screen.queryByText('Selected resource')).not.toBeInTheDocument();
  });

  test('package selection renders real package details and skips missing values', () => {
    render(<DetailsPane selection={packageSelection({ physicalOrder: 0 })} />);

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Full Path');
    expect(details).toHaveTextContent('../../../Engine/Config/Base.ini');
    expect(details).toHaveTextContent('File Name');
    expect(details).toHaveTextContent('Base.ini');
    expect(details).toHaveTextContent('Order');
    expect(details).toHaveTextContent('0');
    expect(details).not.toHaveTextContent('Size');
    expect(details).not.toHaveTextContent('Compressed');
    expect(details).not.toHaveTextContent('Type');
  });

  test('issue selection renders severity, code, and message', () => {
    render(<DetailsPane selection={issueSelection()} />);

    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Severity');
    expect(details).toHaveTextContent('warning');
    expect(details).toHaveTextContent('Code');
    expect(details).toHaveTextContent('UPI001');
    expect(details).toHaveTextContent('Message');
    expect(details).toHaveTextContent('Package index is sparse');
  });
});
