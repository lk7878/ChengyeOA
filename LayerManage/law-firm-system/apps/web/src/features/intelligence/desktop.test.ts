import { afterEach, expect, it, vi } from 'vitest';
import { openCaseAssistant } from './desktop';
import { useCaseWindow } from './window-store';

afterEach(() => { delete window.chengyeDesktop; useCaseWindow.getState().close(); vi.restoreAllMocks(); });

it('opens the same server workspace even when a legacy desktop bridge exists', async () => {
  const openAssistant = vi.fn().mockResolvedValue(undefined);
  window.chengyeDesktop = { version: 1, openAssistant };
  await openCaseAssistant();
  expect(openAssistant).not.toHaveBeenCalled();
  expect(useCaseWindow.getState().open).toBe(true);
});

it('preserves the browser workspace when no desktop bridge exists', async () => {
  await openCaseAssistant();
  expect(useCaseWindow.getState().open).toBe(true);
});

it('does not depend on the retired native startup path', async () => {
  window.chengyeDesktop = { version: 1, openAssistant: vi.fn().mockRejectedValue(new Error('host failed')) };
  await openCaseAssistant();
  expect(window.chengyeDesktop.openAssistant).not.toHaveBeenCalled();
  expect(useCaseWindow.getState().open).toBe(true);
});
