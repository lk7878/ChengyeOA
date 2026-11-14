/** Maintenance-only template materialization; does not launch Harness or access knowledge data. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const usage = 'node scripts/generate-academic-preset.mjs --preset-root <registered-directory> --knowledge-ref <id-or-alias> [--id wiki-academic] [--name <display-name>] [--dry-run]'

async function main() {
  const { values } = parseArgs({ options: {
    'preset-root': { type: 'string' }, 'knowledge-ref': { type: 'string' },
    id: { type: 'string', default: 'wiki-academic' }, name: { type: 'string', default: 'Wiki 学术模式' },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } })
  if (values.help) { process.stdout.write(`${usage}\n`); return }
  if (!values['preset-root']?.trim() || !values['knowledge-ref']?.trim() || !values.name.trim()) {
    throw new Error(`An explicit preset root, knowledge reference and nonempty display name are required.\n${usage}`)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(values.id) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(values.id)) {
    throw new Error('Preset ID must be a non-reserved lowercase name containing only letters, digits and hyphens.')
  }
  const templateRoot = new URL('../templates/academic-wiki/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('template.json', templateRoot), 'utf8'))
  const render = async (file, token, value) => {
    const source = await readFile(new URL(file, templateRoot), 'utf8')
    if (source.split(token).length !== 2) throw new Error(`Template ${file} must contain exactly one ${token}.`)
    return source.replace(token, () => JSON.stringify(value)).replace(/\r\n/gu, '\n').trimEnd() + '\n'
  }
  const composition = await render('agent.cordis.yml', '__KNOWLEDGE_BASE_REF__', values['knowledge-ref'].trim())
  const metadata = await render('preset.yml', '__PRESET_NAME__', values.name.trim())
  const hash = text => createHash('sha256').update(text).digest('hex')
  const origin = JSON.stringify({ template: manifest.id, version: manifest.version, harnessBaseline: manifest.harnessBaseline,
    generatedFiles: { 'agent.cordis.yml': hash(composition), 'preset.yml': hash(metadata) } }, null, 2) + '\n'
  const requestedRoot = resolve(values['preset-root'])
  if (values['dry-run']) {
    process.stdout.write(JSON.stringify({ dryRun: true, directory: join(requestedRoot, values.id), template: manifest.id, version: manifest.version }) + '\n')
    return
  }
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 })
  const directory = join(await realpath(requestedRoot), values.id)
  // A non-recursive mkdir claims a new directory exclusively, including against symlinks or concurrent installs.
  try { await mkdir(directory, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Preset already exists; nothing was overwritten: ${directory}. Choose a new --id to compare an upgrade.`)
    throw error
  }
  // Publish the discoverable composition last. On an I/O failure retain the partial new directory for inspection.
  await writeFile(join(directory, 'preset.yml'), metadata, { flag: 'wx', mode: 0o600 })
  await writeFile(join(directory, 'template-origin.json'), origin, { flag: 'wx', mode: 0o600 })
  await writeFile(join(directory, 'agent.cordis.yml'), composition, { flag: 'wx', mode: 0o600 })
  process.stdout.write(JSON.stringify({ directory, template: manifest.id, version: manifest.version,
    next: 'Start the Product profile using this preset root, then select the new preset in a new session. The bound knowledge base must already exist.' }) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
