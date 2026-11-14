import { describe, expect, it } from 'vitest'
import { decideNavigation } from '../src/navigation-policy.js'

describe('desktop navigation policy', () => {
  const origin = 'http://127.0.0.1:43123'

  it('allows only the exact product host origin in the desktop window', () => {
    expect(decideNavigation(`${origin}/wiki`, origin)).toBe('allow')
    expect(decideNavigation('http://localhost:43123/wiki', origin)).toBe('external')
    expect(decideNavigation('http://127.0.0.1:43124/wiki', origin)).toBe('external')
  })

  it('routes web links externally and denies unsafe protocols', () => {
    expect(decideNavigation('https://example.com/docs', origin)).toBe('external')
    expect(decideNavigation('mailto:person@example.com', origin)).toBe('deny')
    expect(decideNavigation('file:///C:/secret.txt', origin)).toBe('deny')
    expect(decideNavigation('not a url', origin)).toBe('deny')
  })
})
