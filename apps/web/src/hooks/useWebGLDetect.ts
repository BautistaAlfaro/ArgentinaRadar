import { useSyncExternalStore } from 'react';

function getWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl') ||
      canvas.getContext('webgl2') ||
      (typeof WebGLRenderingContext !== 'undefined')
    );
  } catch {
    return false;
  }
}

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): boolean {
  if (cached === null) {
    cached = getWebGLSupport();
  }
  return cached;
}

/**
 * Detects whether the browser supports WebGL.
 * Runs once on first call and caches the result.
 */
export function useWebGLDetect(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
