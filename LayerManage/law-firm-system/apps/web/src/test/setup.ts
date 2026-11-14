import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { act, cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });

afterEach(async () => {
  // Flush scheduled React work before JSDOM tears down window.
  await act(async () => { cleanup(); });
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
