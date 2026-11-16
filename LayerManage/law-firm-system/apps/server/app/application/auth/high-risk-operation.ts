import type { Context } from 'egg';
import type { Prisma } from '@prisma/client';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { SecurityError } from '../../domain/security/security-errors';
import { createAuthenticationServices } from './authentication-factory';

// Match concrete destructive / authority-changing actions, never entire modules.
export function highRiskOperation(method: string, path: string, body: Record<string, unknown> = {}): string | null {
  // Egg accepts case-insensitive routes and an optional trailing slash. Classify
  // those aliases identically; the proof still binds the exact requested path.
  method = method.toUpperCase();
  path = path.replace(/\/+$/, '').toLowerCase();
  body ??= {};
  if (method === 'PUT' && /^\/api\/v1\/cases\/[^/]+$/.test(path)
    && Array.isArray(body.removeAttachmentIds) && body.removeAttachmentIds.length) return '永久删除案件附件';
  if (method === 'PATCH' && /^\/api\/v1\/tables\/[^/]+$/.test(path) && body.remove === true) return '永久销毁工作表及关联数据';
  if (method === 'DELETE' && /^\/api\/v1\/(files|approval-files)\/[^/]+$/.test(path)) return '永久删除附件';
  if (method === 'POST' && /^\/api\/v1\/worksheet-permissions\/[^/]+$/.test(path)) return '修改工作表角色权限';
  if (['POST','PUT','DELETE'].includes(method) && (
    /^\/api\/v1\/roles(?:\/[^/]+(?:\/(permissions|data-scopes|field-permissions|worksheets|applications|disable|enable|apply))?)?$/.test(path)
    || /^\/api\/v1\/users\/[^/]+\/(role-grants|roles|special-grants)(?:\/[^/]+\/revoke)?$/.test(path)
    || /^\/api\/v1\/employees\/[^/]+\/account-binding$/.test(path)
  )) return '修改关键管理权限或账号身份关联';
  if (method === 'PATCH' && /^\/api\/v1\/organizations\/[^/]+$/.test(path)
    && Object.hasOwn(body, 'managerEmployeeId')) return '变更部门负责人及其动态数据权限';
  if (method === 'POST' && /^\/api\/v1\/users\/[^/]+\/password-reset$/.test(path)) return '重置他人登录密码';
  return null;
}

export async function requireHighRiskOperation(ctx: Context, impact: string, tx?: Prisma.TransactionClient): Promise<void> {
  const actor = ctx.state.authorization;
  if (!actor?.isSystemAdmin && !actor?.isSystemSuperAdmin) throw new SecurityError('ADMIN_HIGH_RISK_ONLY', 403);
  const target = { method: ctx.method, path: ctx.path, payloadHash: hashPayload({ body: ctx.request.body ?? {}, query: ctx.query }) };
  const token = ctx.get('x-step-up-token').trim();
  if (!token) throw new SecurityError('STEP_UP_REQUIRED', 403, { purpose: 'ADMIN_HIGH_RISK', target, impact });
  const consume = (client: Prisma.TransactionClient) => createAuthenticationServices(ctx).stepUp.consume(
    client, ctx.state.user, 'ADMIN_HIGH_RISK', target, token,
  );
  if (tx) await consume(tx); else await ctx.prisma.$transaction(consume);
}
