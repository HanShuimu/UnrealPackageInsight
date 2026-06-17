import { describe, expect, test, vi } from 'vitest';

describe('useAppStore', () => {
  test('can be imported without the Electron preload API', async () => {
    vi.resetModules();
    window.upi = undefined;

    await expect(import('./useAppStore')).resolves.toHaveProperty('useAppStore');
  });
});
