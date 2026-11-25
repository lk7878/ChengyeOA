import { authenticatedFetch } from '@/features/workspaces/api';

type Photo = { url: string; bytes: number; expires: number };
/** Page-scoped, bounded cache. Never shared across accounts or persisted. */
export class PhotoCache {
  private entries = new Map<string, Photo>();
  private retained = new Map<string, number>();
  private pending = new Map<string, Promise<string>>();
  private controllers = new Set<AbortController>();
  private queue: (() => void)[] = [];
  private active = 0;
  private generation = 0;
  private external: boolean;
  constructor(external = false) {
    this.external = external;
  }

  load(source: string): Promise<string> {
    const cached = this.entries.get(source);
    if (cached && cached.expires > Date.now()) {
      this.entries.delete(source);
      this.entries.set(source, cached);
      return Promise.resolve(cached.url);
    }
    const existing = this.pending.get(source);
    if (existing) return existing;
    const generation = this.generation;
    const job = this.schedule(async () => {
      if (generation !== this.generation) throw Error('Photo scope changed');
      const controller = new AbortController();
      this.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      let url = '';
      try {
        const response = this.external
          ? await fetch(source, {
              credentials: 'omit',
              signal: controller.signal,
            })
          : await authenticatedFetch(source, controller.signal);
        if (!response.ok) throw Error('Photo unavailable');
        const blob = await response.blob();
        if (blob.size > 10 * 1024 * 1024) throw Error('Photo too large');
        if (controller.signal.aborted || generation !== this.generation)
          throw Error('Photo scope changed');
        url = URL.createObjectURL(blob);
        // Prepare pixels before allowing automatic carousel advancement.
        const image = new Image();
        image.src = url;
        if (image.decode) await image.decode();
        if (controller.signal.aborted || generation !== this.generation)
          throw Error('Photo scope changed');
        const previous = this.entries.get(source);
        if (previous) URL.revokeObjectURL(previous.url);
        this.entries.delete(source);
        this.entries.set(source, {
          url,
          bytes: blob.size,
          expires: Date.now() + 120000,
        });
        this.trim();
        return url;
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        throw error;
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
      }
    });
    this.pending.set(source, job);
    void job
      .finally(() => {
        if (this.pending.get(source) === job) this.pending.delete(source);
      })
      .catch(() => undefined);
    return job;
  }

  private async schedule<T>(run: () => Promise<T>): Promise<T> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await run();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  ready(source: string) {
    const photo = this.entries.get(source);
    return photo && photo.expires > Date.now() ? photo.url : undefined;
  }

  contains(source: string, url: string) {
    return this.entries.get(source)?.url === url;
  }

  retain(source: string) {
    this.retained.set(source, (this.retained.get(source) || 0) + 1);
    return () => {
      const count = (this.retained.get(source) || 1) - 1;
      if (count) this.retained.set(source, count);
      else this.retained.delete(source);
      this.trim();
    };
  }

  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [key, item] of this.entries) {
      if (this.entries.size <= 48 && bytes <= 24 * 1024 * 1024) break;
      if (this.retained.has(key)) continue;
      URL.revokeObjectURL(item.url);
      this.entries.delete(key);
      bytes -= item.bytes;
    }
  }

  clear() {
    this.generation++;
    this.controllers.forEach((controller) => controller.abort());
    this.entries.forEach((item) => URL.revokeObjectURL(item.url));
    this.entries.clear();
    this.pending.clear();
  }
}
