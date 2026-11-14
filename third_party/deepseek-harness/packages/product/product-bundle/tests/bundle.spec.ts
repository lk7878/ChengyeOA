import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('product bundle', () => {
  it('declares one parseable knowledge row and carries preset-scoped tooling in its dependency closure', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; name?: string; config?: Record<string, unknown> }> }>
    expect(patches.flatMap(row => row.insert ?? [])).toEqual([
      {
        id: 'product-knowledge', name: '@deepseek-ai/dsh-product-knowledge',
        config: {
          ocrEnabled: true,
          ocrPythonPath: '../.runtime/paddleocr/Scripts/python.exe',
          ocrModelCachePath: '../.runtime/paddleocr-models',
          ocrDevice: 'cpu',
          ocrTimeoutMs: 300_000,
          ocrNativeMinCharsPerPage: 32,
          ocrRenderWidth: 1_200,
          ocrMaxPdfPages: 200,
          spreadsheetMaxSheets: 64,
          spreadsheetMaxRows: 100_000,
          spreadsheetMaxColumns: 256,
          retrievalMode: 'lexical',
        },
      },
    ])
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-product-knowledge-context')
    expect(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')).not.toContain('studio')
  })
})
