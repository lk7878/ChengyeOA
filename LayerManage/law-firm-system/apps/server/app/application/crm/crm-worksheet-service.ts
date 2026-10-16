import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildLeadScopeWhere } from './lead-scope';
import { editableCrmKey } from './crm-worksheet-fields';
import { LEAD_FOLLOW_TYPES } from './lead-follow-service';
import { hashPhone, hashWechat, normalizePhone } from '../../domain/crm/lead-policy';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { CrmError } from '../../domain/crm/lead-errors';
import {
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeAllowedValue,
  parseIsoDate,
} from '../../domain/master-data/master-data-validation';

/** Canonical CRM mutations, called inside the worksheet transaction (including extensions/outbox). */
export class CrmWorksheetService {
  constructor(
    private readonly db: PrismaClient,
    private readonly actor: AuthorizationContext,
  ) {}
  async mutate(
    source: 'LEADS' | 'FOLLOWS',
    id: string,
    version: number,
    patch: Record<string, unknown>,
    deleting: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const permission = deleting ? (source === 'LEADS' ? 'lead.delete' : 'lead.follow.delete') : 'lead.update';
    const authorization = new AuthorizationService(new DataScopeService(this.db));
    authorization.requireAction(this.actor, permission);
    const scope = await buildLeadScopeWhere(this.db, authorization, this.actor, permission);
    const follow = source === 'FOLLOWS' ? await tx.leadFollow.findUnique({ where: { id, deletedAt: null } }) : null;
    const leadId = source === 'LEADS' ? id : follow?.leadId;
    if (!leadId) throw new CrmError('LEAD_NOT_FOUND', 404, 'record not found');
    await tx.$queryRaw`SELECT id FROM lead WHERE id = ${leadId} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { AND: [scope, { id: leadId, deletedAt: null }] } });
    if (!lead) throw new CrmError('LEAD_NOT_FOUND', 404, 'record not found');
    const currentVersion = source === 'LEADS' ? lead.version : follow!.version;
    if (currentVersion !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
    for (const key of Object.keys(patch))
      if (deleting || !editableCrmKey(source, key, this.actor))
        throw new MasterDataError('VALIDATION_FAILED', 400);
    if (source === 'LEADS') {
      const data: Prisma.LeadUncheckedUpdateManyInput = {
        updatedBy: this.actor.userId,
        version: { increment: 1 },
      };
      if (deleting) {
        const linked = await tx.lead.count({
          where: {
            id,
            OR: [
              { customer: { isNot: null } },
              { appointments: { some: {} } },
              { sopInstances: { some: {} } },
            ],
          },
        });
        if (lead.status === 'CONVERTED' || linked)
          throw new CrmError('LEAD_IN_USE', 409, 'lead has business references');
        data.deletedAt = new Date();
      } else {
        if (patch.name !== undefined) data.name = normalizeName(patch.name);
        if (Object.hasOwn(patch, 'phone')) {
          data.phone = normalizePhone(patch.phone);
          data.phoneHash = hashPhone(data.phone);
        }
        if (Object.hasOwn(patch, 'wechat')) {
          data.wechat = normalizeOptionalText(patch.wechat, 100);
          data.wechatHash = hashWechat(data.wechat);
        }
        if (Object.hasOwn(patch, 'intentionLevel')) {
          const level = normalizeNonNegativeInteger(patch.intentionLevel);
          if (level < 1 || level > 5) throw new MasterDataError('VALIDATION_FAILED', 400);
          data.intentionLevel = level;
        }
      }
      const changed = await tx.lead.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
    } else if (deleting) {
      const changed = await tx.leadFollow.updateMany({ where: { id, version, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: this.actor.userId, version: { increment: 1 } } });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
    } else {
      const data: Prisma.LeadFollowUpdateManyMutationInput = {
        updatedBy: this.actor.userId,
        version: { increment: 1 },
      };
      if (Object.hasOwn(patch, 'type')) data.type = normalizeAllowedValue(patch.type, LEAD_FOLLOW_TYPES);
      if (Object.hasOwn(patch, 'content')) data.content = normalizeRequiredText(patch.content, 1, 2000);
      if (Object.hasOwn(patch, 'nextPlan')) data.nextPlan = normalizeOptionalText(patch.nextPlan, 500);
      if (Object.hasOwn(patch, 'nextTime'))
        data.nextTime =
          patch.nextTime === null || patch.nextTime === '' ? null : parseIsoDate(patch.nextTime);
      const changed = await tx.leadFollow.updateMany({ where: { id, version }, data });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
    }
    await tx.operationLog.create({
      data: {
        userId: this.actor.userId,
        action:
          source === 'LEADS'
            ? deleting
              ? 'LEAD_DELETE'
              : 'LEAD_UPDATE'
            : deleting
              ? 'LEAD_FOLLOW_DELETE'
              : 'LEAD_FOLLOW_UPDATE',
        targetType: 'LEAD',
        targetId: leadId,
        newValues: JSON.stringify({ recordId: id, fields: Object.keys(patch), version: version + 1 }),
      },
    });
    return { id, version: version + 1 };
  }
}
