import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const script = join(packageRoot, 'scripts/generate-academic-preset.mjs')
const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: unknown) => value })])
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 })
async function directory() { const root = await mkdtemp(join(tmpdir(), 'academic-template-')); roots.push(root); return root }

describe('academic Wiki preset template', () => {
  it('generates independently bound presets, tracks versions and preserves the standard tool composition', async () => {
    const root = await directory()
    const ref = 'paper: "quoted"\n- id: not-a-plugin'
    const name = '学术研究 "甲"\n第二行'
    const result = run('--preset-root', root, '--knowledge-ref', ref, '--name', name)
    expect(result.status, result.stderr).toBe(0)
    expect(run('--preset-root', root, '--knowledge-ref', 'second-library', '--id', 'wiki-second').status).toBe(0)
    const installed = await readFile(join(root, 'wiki-academic/agent.cordis.yml'), 'utf8')
    const rows = yaml.load(installed, { schema }) as Array<{ id: string; config: Record<string, unknown> }>
    expect(rows.find(row => row.id === 'product-knowledge-context')?.config).toEqual({ bindings: [
      { role: 'primary', ref, revision: 'latest', required: true },
    ] })
    expect(yaml.load(await readFile(join(root, 'wiki-academic/preset.yml'), 'utf8'))).toMatchObject({ name })
    const standard = yaml.load(await readFile(new URL('../../../preset/agent-presets/presets/standard/agent.cordis.yml', import.meta.url), 'utf8'), { schema }) as Array<{ id: string }>
    expect(rows.filter(row => row.id !== 'persona' && row.id !== 'product-knowledge-context')).toEqual(standard.filter(row => row.id !== 'persona'))
    expect(rows.find(row => row.id === 'persona')?.config.text).toMatchSnapshot('academic retrieval instructions')
    const origin = JSON.parse(await readFile(join(root, 'wiki-academic/template-origin.json'), 'utf8')) as { generatedFiles: Record<string, string> }
    expect(origin).toMatchObject({ template: 'academic-wiki', version: '1.0.0' })
    expect(origin.generatedFiles['agent.cordis.yml']).toBe(createHash('sha256').update(installed).digest('hex'))
    const discovered = await discoverPresets([{ path: root, trust: 'user' }], new URL('../../../product/product-bundle/', import.meta.url).href)
    expect(discovered.map(preset => preset.id).sort()).toEqual(['wiki-academic', 'wiki-second'])
    expect(discovered.find(preset => preset.id === 'wiki-academic')?.name).toBe(name)
  })

  it('refuses overwrite and invalid IDs, and supports a non-mutating preview', async () => {
    const root = await directory()
    expect(run('--preset-root', root, '--knowledge-ref', 'papers', '--dry-run').status).toBe(0)
    expect(await readdir(root)).toEqual([])
    for (const id of ['../escape', 'a/b', 'CON', 'nul']) {
      expect(run('--preset-root', root, '--knowledge-ref', 'papers', '--id', id).status).not.toBe(0)
    }
    expect(run('--preset-root', root).status).not.toBe(0)
    expect(await readdir(root)).toEqual([])
    expect(run('--preset-root', root, '--knowledge-ref', 'papers').status).toBe(0)
    const path = join(root, 'wiki-academic/agent.cordis.yml')
    await writeFile(path, '# Personal edits must survive.\n')
    const again = run('--preset-root', root, '--knowledge-ref', 'other')
    expect(again.status).not.toBe(0)
    expect(again.stderr).toContain('nothing was overwritten')
    expect(await readFile(path, 'utf8')).toBe('# Personal edits must survive.\n')
  })

  it('ships reusable templates and generator without personal paths or knowledge IDs', async () => {
    const template = await readFile(join(packageRoot, 'templates/academic-wiki/agent.cordis.yml'), 'utf8')
    expect(template).not.toMatch(/BioMech|2ab2ad24|C33_deepseek-harness|[A-Z]:[\\/]/u)
    expect(template).toContain('__KNOWLEDGE_BASE_REF__')
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { files: string[] }
    expect(manifest.files).toContain('templates')
    expect(manifest.files).toContain('scripts/generate-academic-preset.mjs')
  })
})
