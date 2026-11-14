/** Package invariant companion for product knowledge. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'product-knowledge-invariant'
export const inject = ['invariants']
/** No runtime invariant: SQLite owns validation and transaction boundaries. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(
  ctx.invariants.register('@deepseek-ai/dsh-product-knowledge', install),
)
