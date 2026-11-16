import type { CheckerApi } from '../preload';

declare global {
  interface Window {
    checker: CheckerApi;
  }
}

/** The bridge the sandboxed preload script exposes. */
export const checker: CheckerApi = window.checker;
