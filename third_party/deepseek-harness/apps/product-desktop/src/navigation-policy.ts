/** Navigation outcomes enforced by the Electron shell. */
export type NavigationDecision = 'allow' | 'external' | 'deny'

/** Keep the product inside its exact host origin and route other web links externally. */
export function decideNavigation(target: string, allowedOrigin: string): NavigationDecision {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'deny'
  }
  if (url.origin === allowedOrigin && url.protocol === 'http:') return 'allow'
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'external'
  return 'deny'
}
