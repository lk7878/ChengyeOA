import { createPortal as nativePortal } from '../node_modules/react-dom/index.js';
export * from '../node_modules/react-dom/index.js';

let target: HTMLElement | undefined;
export function setPortalTarget(value: HTMLElement | undefined) { target = value; }
/** Keep upstream body portals and their theme within this independent shadow root. */
export const createPortal: typeof nativePortal = (children, container, key) =>
  nativePortal(children, container === document.body && target ? target : container, key);
