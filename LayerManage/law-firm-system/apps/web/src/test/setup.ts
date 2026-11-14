import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }),
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub;
