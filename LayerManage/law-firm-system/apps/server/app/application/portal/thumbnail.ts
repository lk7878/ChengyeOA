import sharp from 'sharp';

const cache = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
let totalBytes = 0;
/** Call only after readAsset has checked the current publication and subject. */
export async function portalThumbnail(id: string, bytes: Buffer, display = false): Promise<Buffer> {
  id = `${id}:${display ? 'display' : 'card'}`;
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const running = pending.get(id);
  if (running) return running;
  const job = sharp(bytes, { limitInputPixels: 100000000 })
    .rotate()
    .resize({
      width: display ? 1600 : 400,
      height: display ? 1600 : 520,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: display ? 88 : 82 })
    .toBuffer()
    .then((output) => {
      cache.set(id, output);
      totalBytes += output.length;
      while (cache.size > 128 || totalBytes > 32 * 1024 * 1024) {
        const [key, value] = cache.entries().next().value!;
        cache.delete(key);
        totalBytes -= value.length;
      }
      return output;
    })
    .finally(() => pending.delete(id));
  pending.set(id, job);
  return job;
}
