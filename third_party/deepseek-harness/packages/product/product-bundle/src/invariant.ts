/** Product Bundle invariant companion. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'product-bundle-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package is a static composition layer. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@deepseek-ai/dsh-product-bundle', install),
)
