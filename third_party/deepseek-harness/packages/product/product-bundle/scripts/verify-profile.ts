/**
 * Verify the formal product Profile composition without touching the user's
 * Harness home. The script exercises the public `dsh plugin --profile` path,
 * checks the ordered Bundle manifest, and confirms the composed configuration
 * contains the F001 knowledge row.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageDir, '../../..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-product-profile-'))
const harnessHome = join(temporaryRoot, 'home')
const profileManifest = join(harnessHome, 'profiles', 'product', 'package.json')

function runDsh(args: readonly string[], capture = false): string {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: harnessHome, NO_COLOR: '1' },
      stdio: capture ? 'pipe' : 'inherit',
    },
  )
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? '')
      process.stderr.write(result.stderr ?? '')
    }
    throw new Error(`dsh ${args.join(' ')} exited with ${result.status ?? 'no status'}`)
  }
  return result.stdout ?? ''
}

try {
  runDsh([
    'plugin', '--profile', 'product', 'add',
    './packages/bundle/web-app',
  ])
  runDsh([
    'plugin', '--profile', 'product', 'add',
    './packages/product/product-bundle',
  ])

  const manifest = JSON.parse(readFileSync(profileManifest, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  const expected = [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-product-bundle',
  ]
  const actual = manifest.dsh?.profile?.bundles
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`unexpected product Profile layers: ${JSON.stringify(actual)}`)
  }

  const dump = runDsh(['--profile', 'product', '--dump-default-config'], true)
  if (!dump.includes("name: '@deepseek-ai/dsh-product-knowledge'")) {
    throw new Error('composed product Profile does not contain the F001 knowledge row')
  }
  const help = runDsh(['--profile', 'product', '--help'], true)
  if (!help.includes('--port')) {
    throw new Error('product Profile did not mount the Web application command line')
  }
  process.stdout.write(`verified isolated product Profile: ${expected.join(' -> ')}\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
