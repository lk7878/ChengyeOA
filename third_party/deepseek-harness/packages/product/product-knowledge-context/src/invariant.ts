/** Package invariant companion for product knowledge context. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
export const name = 'product-knowledge-context-invariant'
export const inject = ['invariants']
/** No runtime invariant: tool registration and binding resolution fail closed. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@deepseek-ai/dsh-product-knowledge-context', install),
)
