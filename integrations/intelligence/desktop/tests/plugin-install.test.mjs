import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDesktopPlugin } from '../plugin-install.mjs';

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'chengye-plugin-upgrade-')), pluginPath = join(home, 'desktop-plugin');
  const profile = join(home, 'harness/profiles/product');
  await mkdir(pluginPath); await mkdir(profile, { recursive: true });
  await writeFile(join(pluginPath, 'package.json'), JSON.stringify({ name: '@chengyeoa/harness-desktop-tools' }));
  await writeFile(join(pluginPath, 'index.mjs'), '');
  await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { existing: 'preserved' }, dsh: { profile: { bundles: ['base', 'web', 'product'] } } }));
  await writeFile(join(home, 'harness/settings.yaml'), 'personal-setting: preserved');
  return { home, pluginPath, profile, vendorPath: join(home, 'vendor'), nodePath: process.execPath, env: { DSH_HOME: join(home, 'harness') } };
}
test('upgrades a stage-one profile using only the fixed local plugin and skips subsequent installation', async () => {
  const input = await fixture(); let installs = 0;
  const run = async (command, args, options) => {
    installs++; assert.equal(command, process.execPath); assert.deepEqual(args.slice(1, 5), ['plugin', '--profile', 'product', 'add']);
    assert.match(args[5], /^link:/); assert.equal(options.cwd, input.home);
    const path = join(input.profile, 'package.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.dependencies['@chengyeoa/harness-desktop-tools'] = args[5];
    await writeFile(path, JSON.stringify(manifest));
    await mkdir(join(input.profile, 'node_modules/@chengyeoa'), { recursive: true });
    await symlink(input.pluginPath, join(input.profile, 'node_modules/@chengyeoa/harness-desktop-tools'), 'junction');
  };
  assert.equal((await ensureDesktopPlugin(input, run)).repaired, true);
  assert.equal((await ensureDesktopPlugin(input, run)).repaired, false);
  assert.equal(installs, 1);
  assert.equal(await readFile(join(input.home, 'harness/settings.yaml'), 'utf8'), 'personal-setting: preserved');
  assert.equal(JSON.parse(await readFile(join(input.profile, 'package.json'), 'utf8')).dependencies.existing, 'preserved');
});
test('installer failure and a false success stop startup without leaking installer output', async () => {
  const input = await fixture();
  await assert.rejects(ensureDesktopPlugin(input, async () => { throw new Error('private installer diagnostic'); }), /本地知识库组件准备失败/);
  await assert.rejects(ensureDesktopPlugin(input, async () => {}), /本地知识库组件准备失败/);
});
