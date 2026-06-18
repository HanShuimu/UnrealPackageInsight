import type { UpiClient } from '../types/upi';

declare global {
  interface Window {
    upi?: UpiClient;
  }
}

export {};
