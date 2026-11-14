import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vendor = resolve(root, '../../third_party/deepseek-harness');
const { parse } = createRequire(join(vendor, 'packages/skill/skill-filesystem/package.json'))('yaml');
const preset = join(root, 'desktop-plugin/presets/lawyer');
const names = ['china-legal-query', 'contract-review', 'litigation-jurisdiction', 'litigation-response'];
const yaml = text => parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });

test('four shipped legal skills have valid native metadata and complete local resources', async () => {
  assert.deepEqual((await readdir(join(preset, 'skills'))).sort(), names);
  for (const name of names) {
    const folder = join(preset, 'skills', name);
    const entry = await readFile(join(folder, 'SKILL.md'), 'utf8');
    const header = parse(entry.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
    assert.equal(header.name, name);
    assert.equal(typeof header.description, 'string');
    assert.notEqual(header['disable-model-invocation'], true);
    assert.notEqual(header['user-invocable'], false);
    for (const relative of await readdir(folder, { recursive: true })) {
      if (!relative.endsWith('.md')) continue;
      const path = join(folder, relative), content = await readFile(path, 'utf8');
      assert.doesNotMatch(content, /tvly-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|[A-Z]:[\\/]|\/mnt\/|\/Users\//);
      for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^https?:/.test(match[1])) continue;
        const resource = resolve(dirname(path), match[1]);
        assert.ok(resource.startsWith(folder + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')));
        assert.ok((await readFile(resource, 'utf8')).trim());
      }
    }
  }
});

test('lawyer retains standard tools; only persona and explicit native skill root differ', async () => {
  const actual = yaml(await readFile(join(preset, 'agent.cordis.yml'), 'utf8'));
  const standard = yaml(await readFile(join(vendor, 'packages/preset/agent-presets/presets/standard/agent.cordis.yml'), 'utf8'));
  const skill = actual.find(row => row.id === 'skill-filesystem');
  assert.equal(skill.config.customSkillDirs[0], "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))");
  delete skill.config;
  assert.deepEqual(actual.filter(row => row.id !== 'persona'), standard.filter(row => row.id !== 'persona'));
  const pkg = JSON.parse(await readFile(join(root, 'desktop-plugin/package.json'), 'utf8'));
  assert.ok(pkg.files.includes('presets'), 'distribution must include skill resources beside preset');
});
