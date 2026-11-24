import { PrismaClient, Prisma } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { assertExactKeys } from '../../domain/master-data/master-data-validation';
import { check } from '../../domain/workflow/schema';

type DB = PrismaClient | Prisma.TransactionClient;
export async function validateCaseSource(db: DB, value?: string, previous?: string) {
  if (!value || value === previous) return;
  check(await db.caseSource.findFirst({ where: { name: value, enabled: true } }), '案件来源已停用或不存在，请重新选择');
}

export class CaseSourceService {
  constructor(readonly db: PrismaClient, readonly actor: AuthorizationContext) {}
  async list() {
    return { canManage: this.actor.isSystemSuperAdmin,
      items: await this.db.caseSource.findMany({ where: this.actor.isSystemSuperAdmin ? {} : { enabled: true }, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] }) };
  }
  async save(input: { name: string; enabled?: boolean; version?: number }) {
    assertExactKeys(input, ['name', 'enabled', 'version']);
    const actor = await new AuthorizationContextLoader(this.db).load(this.actor.userId);
    check(actor.isSystemSuperAdmin, '仅超级管理员可维护案件来源', 403);
    check(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.trim().length <= 100, '来源名称需为 1–100 个字');
    const name = input.name.trim();
    check(input.enabled === undefined || typeof input.enabled === 'boolean', '来源状态无效');
    check(input.version === undefined || Number.isSafeInteger(input.version) && input.version > 0, '版本无效');
    return this.db.$transaction(async tx => {
      // Serialize changes by name, including simultaneous creation of the same option.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
      const previous = await tx.caseSource.findUnique({ where: { name } });
      check(previous ? input.version === previous.version : input.version === undefined, '来源已存在或已被修改，请刷新后重试', 409);
      const saved = previous
        ? await tx.caseSource.update({ where: { name }, data: { enabled: input.enabled ?? previous.enabled, version: { increment: 1 } } })
        : await tx.caseSource.create({ data: { name, enabled: input.enabled ?? true } });
      await tx.operationLog.create({ data: { userId: actor.userId, action: 'CASE_SOURCE_SAVE', targetType: 'CASE_SOURCE', targetId: name,
        oldValues: previous ? JSON.stringify(previous) : undefined, newValues: JSON.stringify(saved) } });
      return saved;
    });
  }
}
