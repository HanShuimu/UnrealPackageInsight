import type { UpiClient } from '../types/upi';

export function getUpiClient(): UpiClient {
  if (!window.upi) {
    throw new Error('UPI preload API is unavailable.');
  }
  return window.upi;
}
