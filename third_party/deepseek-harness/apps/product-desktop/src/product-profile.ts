import { readFile } from 'node:fs/promises'
import path from 'node:path'

const REQUIRED_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-product-bundle']

/** Confirm that a profile manifest launches the formal product composition in order. */
export function assertProductProfileManifest(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The product profile must contain Base, Web, and Product bundles only.')
  }
  const profile = value as { dsh?: { profile?: { bundles?: unknown } } }
  const bundles = profile.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.length !== REQUIRED_BUNDLES.length) {
    throw new Error('The product profile must contain Base, Web, and Product bundles only.')
  }
  for (const [index, expected] of REQUIRED_BUNDLES.entries()) {
    if (bundles[index] !== expected) {
      throw new Error(`The product profile bundle at position ${index + 1} must be ${expected}.`)
    }
  }
}

/** Resolve and validate the dedicated product profile under DSH_HOME. */
export async function validateProductProfile(dshHome: string | undefined): Promise<string> {
  if (!dshHome) throw new Error('DSH_HOME must point to a prepared Harness home directory.')
  const manifestPath = path.join(dshHome, 'profiles', 'product', 'package.json')
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read the product profile manifest at ${manifestPath}.`, { cause: error })
  }
  assertProductProfileManifest(manifest)
  return manifestPath
}
