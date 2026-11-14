import { afterEach, expect, test, vi } from 'vitest';
import { createRefreshScheduler } from './refresh-scheduler';

afterEach(() => vi.useRealTimers());

test('read-only summaries refresh promptly on notifications, while editable grids retain draft protection', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  let summary = true;
  let editing = false;
  const scheduler = createRefreshScheduler(
    refresh,
    () => editing,
    () => (summary ? 1000 : 30_000),
  );
  scheduler.queue();
  scheduler.queue();
  vi.advanceTimersByTime(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  summary = false;
  editing = true;
  scheduler.queue();
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  editing = false;
  vi.advanceTimersByTime(30_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

test('bursts coalesce, editing defers updates, and disposal cancels queued work', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  let editing = false;
  const scheduler = createRefreshScheduler(refresh, () => editing);
  for (let i = 0; i < 100; i++) scheduler.queue();
  vi.advanceTimersByTime(29_999);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  editing = true;
  scheduler.queue();
  vi.advanceTimersByTime(90_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  editing = false;
  vi.advanceTimersByTime(30_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  scheduler.queue();
  scheduler.dispose();
  vi.advanceTimersByTime(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});
