import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { VisibleTreeParentTrail } from './VisibleTreeParentTrail';

describe('VisibleTreeParentTrail', () => {
  test('renders each visible parent level as its own tree-like row', () => {
    render(<VisibleTreeParentTrail trail={['Paks', 'Content', 'Windows']} />);

    const trail = screen.getByLabelText('Current visible parents');
    const levels = within(trail).getAllByRole('listitem');

    expect(trail).toHaveAttribute('title', 'Paks / Content / Windows');
    expect(levels.map((level) => level.textContent)).toEqual(['Paks', 'Content', 'Windows']);
    expect(levels[0]).toHaveAttribute('aria-level', '1');
    expect(levels[1]).toHaveAttribute('aria-level', '2');
    expect(levels[2]).toHaveAttribute('aria-level', '3');
  });
});
