import type { GearscapeApi } from '../preload/index';

declare global {
  interface Window {
    gearscape: GearscapeApi;
  }
}

export {};
