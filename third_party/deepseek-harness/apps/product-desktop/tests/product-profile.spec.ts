import { describe, expect, it } from 'vitest'
import { assertProductProfileManifest } from '../src/product-profile.js'

const bundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-product-bundle',
]

describe('product profile preflight', () => {
  it('accepts the formal product bundle stack', () => {
    expect(() => { assertProductProfileManifest({ dsh: { profile: { bundles } } }) }).not.toThrow()
  })

  it('rejects missing, reordered, or additional bundles', () => {
    expect(() => { assertProductProfileManifest(null) }).toThrow('Base, Web, and Product')
    expect(() => { assertProductProfileManifest({}) }).toThrow('Base, Web, and Product')
    expect(() => { assertProductProfileManifest({ dsh: { profile: { bundles: [...bundles].reverse() } } }) }).toThrow('position 1')
    expect(() => { assertProductProfileManifest({ dsh: { profile: { bundles: [...bundles, 'extra'] } } }) }).toThrow('only')
  })
})
