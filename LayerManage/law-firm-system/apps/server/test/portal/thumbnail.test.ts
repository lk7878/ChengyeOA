import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { portalThumbnail } from '../../app/application/portal/thumbnail';

test('portrait thumbnail preserves aspect ratio, reduces payload, and leaves original intact', async () => {
  const original = await sharp({
    create: { width: 5200, height: 7800, channels: 3, background: '#789abc' },
  })
    .jpeg()
    .toBuffer();
  const copy = Buffer.from(original);
  const [a, b] = await Promise.all([
    portalThumbnail('synthetic-large', original),
    portalThumbnail('synthetic-large', original),
  ]);
  const meta = await sharp(a).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.height, 520);
  assert.ok(meta.width! <= 400);
  assert.ok(Math.abs(meta.width! / meta.height! - 2 / 3) < 0.01);
  assert.ok(a.length < original.length);
  assert.equal(a, b);
  assert.deepEqual(original, copy);
});

test('small images are not enlarged and a failed conversion can be retried', async () => {
  await assert.rejects(portalThumbnail('synthetic-retry', Buffer.from('invalid')));
  const original = await sharp({
    create: { width: 60, height: 80, channels: 3, background: '#abcdef' },
  })
    .png()
    .toBuffer();
  const meta = await sharp(await portalThumbnail('synthetic-retry', original)).metadata();
  assert.equal(meta.width, 60);
  assert.equal(meta.height, 80);
});

test("large display pictures use a separate bounded size and cache from cards", async () => {
  const original = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: "#abcdef" },
  })
    .jpeg()
    .toBuffer();
  const card = await portalThumbnail("shared-asset", original);
  const display = await portalThumbnail("shared-asset", original, true);
  const small = await sharp(card).metadata();
  const large = await sharp(display).metadata();
  assert.equal(small.width, 400);
  assert.equal(large.width, 1600);
  assert.equal(large.height, 1200);
  assert.equal(await portalThumbnail("shared-asset", original, true), display);
  assert.equal(await portalThumbnail("shared-asset", original), card);
});
