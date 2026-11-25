import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { authenticatedFetch } from '@/features/workspaces/api';
import { PhotoCache } from './photo-cache';
vi.mock('@/features/workspaces/api', () => ({ authenticatedFetch: vi.fn() }));
const response = () => ({ ok: true, blob: async () => new Blob(['photo']) }) as Response;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.mocked(authenticatedFetch).mockResolvedValue(response());
});
afterEach(() => vi.restoreAllMocks());
test('concurrent and repeated portrait requests share one download', async () => {
  const cache = new PhotoCache();
  const [a, b] = await Promise.all([cache.load('/photo'), cache.load('/photo')]);
  expect(a).toBe(b);
  expect(await cache.load('/photo')).toBe(a);
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  cache.clear();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(a);
});
test('preloads use at most three simultaneous downloads', async () => {
  const finishes: (() => void)[] = [];
  vi.mocked(authenticatedFetch).mockImplementation(
    () => new Promise((resolve) => finishes.push(() => resolve(response()))),
  );
  const cache = new PhotoCache();
  const jobs = Array.from({ length: 8 }, (_, i) => cache.load('/photo/' + i));
  expect(authenticatedFetch).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 8; i++) {
    await vi.waitFor(() => expect(finishes.length).toBeGreaterThan(i));
    finishes[i]();
  }
  await Promise.all(jobs);
  cache.clear();
});
test('scope disposal aborts downloads and rejects late account results', async () => {
  let finish!: (r: Response) => void;
  vi.mocked(authenticatedFetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const cache = new PhotoCache();
  const job = cache.load('/private');
  const rejected = expect(job).rejects.toThrow('Photo scope changed');
  cache.clear();
  expect(vi.mocked(authenticatedFetch).mock.calls[0][1]?.aborted).toBe(true);
  finish(response());
  await rejected;
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test('failed requests can retry and old unretained portraits are evicted', async () => {
  const cache = new PhotoCache();
  vi.mocked(authenticatedFetch).mockResolvedValueOnce({
    ok: false,
  } as Response);
  await expect(cache.load('/failed')).rejects.toThrow();
  const first = await cache.load('/failed');
  for (let i = 0; i < 48; i++) await cache.load('/' + i);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  await cache.load('/failed');
  expect(authenticatedFetch).toHaveBeenCalledTimes(51);
  cache.clear();
});

test('a preload does not finish until image decoding is ready', async () => {
  let decoded!: () => void;
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: () =>
      new Promise<void>((resolve) => {
        decoded = resolve;
      }),
  });
  const cache = new PhotoCache();
  try {
    let ready = false;
    const job = cache.load('/decode').then(() => {
      ready = true;
    });
    await vi.waitFor(() => expect(decoded).toBeTypeOf('function'));
    expect(ready).toBe(false);
    decoded();
    await job;
    expect(ready).toBe(true);
  } finally {
    cache.clear();
    if (original) Object.defineProperty(HTMLImageElement.prototype, 'decode', original);
    else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
  }
});
