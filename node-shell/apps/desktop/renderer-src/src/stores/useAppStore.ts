import { useStore } from 'zustand';
import { getUpiClient } from '../ipc/upiClient';
import { createAppStore, type AppState } from './appStore';

export const appStore = createAppStore(getUpiClient());

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
