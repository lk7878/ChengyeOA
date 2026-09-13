import { afterEach, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { openCaseAssistant } from './desktop';
import { useCaseWindow } from './window-store';

afterEach(() => { delete window.chengyeDesktop; useCaseWindow.getState().close(); vi.restoreAllMocks(); });

it('opens native Harness in a desktop host without opening the browser workspace', async () => {
  const openAssistant = vi.fn().mockResolvedValue(undefined);
  window.chengyeDesktop = { version: 1, openAssistant };
  await openCaseAssistant();
  expect(openAssistant).toHaveBeenCalledWith();
  expect(useCaseWindow.getState().open).toBe(false);
});

it('preserves the browser workspace when no desktop bridge exists', async () => {
  await openCaseAssistant();
  expect(useCaseWindow.getState().open).toBe(true);
});

it('reports native startup failure without silently switching storage mode', async () => {
  window.chengyeDesktop = { version: 1, openAssistant: vi.fn().mockRejectedValue(new Error('host failed')) };
  const report = vi.spyOn(message, 'error').mockImplementation(() => (() => {}) as ReturnType<typeof message.error>);
  await openCaseAssistant();
  expect(report).toHaveBeenCalled();
  expect(useCaseWindow.getState().open).toBe(false);
});
