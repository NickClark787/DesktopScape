import type { DesktopScapeApi } from '../preload/index';

declare global {
  interface Window {
    desktopscape: DesktopScapeApi;
  }
}

export {};
