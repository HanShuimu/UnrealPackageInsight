import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { getUpiClient } from '../ipc/upiClient';
import { createAppStore, type AppState } from './appStore';

let appStore: StoreApi<AppState> | null = null;

export function getAppStore(): StoreApi<AppState> {
  appStore ??= createAppStore(getUpiClient());
  return appStore;
}

export function setAppStoreForTests(store: StoreApi<AppState> | null): void {
  appStore = store;
}

export function resetAppStoreForTests(): void {
  appStore = null;
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(getAppStore(), selector);
}
