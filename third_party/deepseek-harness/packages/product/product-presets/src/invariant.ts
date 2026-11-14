/** Empty invariant companion: this package contains static preset templates only. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'product-presets-invariant'
export const inject = ['invariants']
/** No runtime invariant: this package contains source templates only. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@deepseek-ai/dsh-product-presets', install),
)
