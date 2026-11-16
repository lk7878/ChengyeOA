import 'dotenv/config';
import { CollabField, PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';
import { CUSTOMER_ROUTE_TRIGGER, CustomerRouteAction, syncCustomerSource } from '../../app/application/collaboration/customer-source-routing';
import { lawyerProspectFields } from '../../app/application/collaboration/lawyer-prospect-template';
import { json, object } from '../../app/application/collaboration/collaboration-policy';

// Preserve corresponding field restrictions when replacing the obsolete FOLLOWS projection.
function remapLegacyRules(raw: unknown, before: CollabField[], after: CollabField[]) {
  const aliases: Record<string,string> = { customerName: '客户姓名', phone: '联系方式', region: '地区', updatedAt: '最后更新时间', enteredAt: '创建时间', nextTime: '下次跟进时间', nextPlan: '后续跟进事项' };
  const retiredMetadata = ['followNo','leadId','lastFollowBy','lastOperator'];
  return Object.fromEntries(Object.entries(object(raw)).map(([roleId, value]) => {
    const rule = object(value), fields: Record<string,unknown> = {};
    if (rule.filter || rule.viewIds) throw new Error('旧表有条件或视图授权，请先核对独立客资表授权');
    for (const [id, mode] of Object.entries(object(rule.fields ?? {}))) {
      const old = before.find(f => f.id === id);
      const businessKey = String(object(old?.options ?? {}).businessKey ?? '');
      const target = after.find(f => f.name === (aliases[businessKey] ?? old?.name));
      if (target) fields[target.id] = mode;
      else if (!retiredMetadata.includes(businessKey) || !['READ','EDIT'].includes(String(mode))) throw new Error('旧表存在无法映射的字段授权，请先核对');
    }
    // The new custom worksheet no longer grants actions on canonical leads/follows.
    const rest = { ...rule };
    delete rest.business;
    return [roleId, { ...rest, fields }];
  }));
}

export type RoutingSetup = { sourceTableId: string; lawyerNames: string[]; replaceLegacyTable?: boolean };
/** Explicit, previewable setup: no name-based runtime routing or rewriting of old follow-up rows. */
export async function configureCustomerRouting(db: PrismaClient, actorId: string, setup: RoutingSetup, apply = false) {
  const actor = await new AuthorizationContextLoader(db).load(actorId);
  if (!actor.isSystemSuperAdmin) throw new Error('仅超级管理员可配置客户自动分发');
  return db.$transaction(async tx => {
    const source = await tx.collabTable.findUniqueOrThrow({ where: { id: setup.sourceTableId }, include: { fields: true, base: { include: { driveNode: true } } } });
    if (source.archived || source.source !== 'CUSTOMERS' || source.base.driveNode?.deletedAt) throw new Error('客户主表不可用');
    await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${source.base.workspaceId} FOR UPDATE`;
    const tables = await tx.collabTable.findMany({ where: { baseId: source.baseId, archived: false }, include: { fields: true, rolePolicy: true } });
    const sourceField = source.fields.find(f => !f.archived && f.name === '客户来源');
    if (sourceField && (sourceField.type !== 'SINGLE_SELECT' || object(sourceField.options).businessKey)) throw new Error('已有客户来源字段类型不符，请先核对');
    const plan = setup.lawyerNames.map(name => {
      const table = tables.find(t => t.name === name + '客资表');
      if (!table) throw new Error('未找到客资表：' + name);
      if (table.source !== 'CUSTOM' && !setup.replaceLegacyTable) throw new Error('旧业务表需明确选择移除并新建：' + table.name);
      if (table.inventoryKind || table.lifecycleKind) throw new Error('不能将系统业务模板作为分发目标');
      return { name, table, replaceLegacy: table.source !== 'CUSTOM' };
    });
    const report = { sourceTableId: source.id, sourceFieldExists: !!sourceField, targets: plan.map(p => ({ name: p.table.name, tableId: p.table.id, replaceLegacy: p.replaceLegacy })) };
    if (!apply) return report;
    const existingChoices = (object(sourceField?.options ?? {}).choices ?? []) as { id: string; name: string }[];
    const choices = [...existingChoices];
    for (const name of ['美团','高德','自上门', ...setup.lawyerNames]) if (!choices.some(c => c.name === name)) choices.push({ id: name, name });
    const field = sourceField ? await tx.collabField.update({ where: { id: sourceField.id }, data: { options: json({ ...object(sourceField.options), choices }) } })
      : await tx.collabField.create({ data: { tableId: source.id, name: '客户来源', type: 'SINGLE_SELECT', position: source.fields.length, options: json({ choices }) } });
    const routes: CustomerRouteAction['routes'] = {};
    for (const item of plan) {
      let target = item.table;
      if (item.replaceLegacy) {
        const grants = object(target.accessPolicy ?? {}).grants;
        if (Array.isArray(grants) && grants.some(g => { const grant = object(g); return [grant.hiddenFields, grant.readonlyFields].some(ids => Array.isArray(ids) && ids.length); })) throw new Error('旧表存在字段级授权，请先核对独立客资表授权');
        const historyName = target.name + '（已移除-' + target.id.slice(0, 8) + '）';
        if (tables.some(t => t.name === historyName)) throw new Error('历史跟进表名称已存在');
        await tx.collabTable.update({ where: { id: target.id }, data: { name: historyName, archived: true, schemaVersion: { increment: 1 } } });
        const created = await tx.collabTable.create({ data: { baseId: source.baseId, name: item.name + '客资表', source: 'CUSTOM', createdBy: actorId, position: target.position + 1, accessPolicy: target.accessPolicy ?? undefined,
          fields: { create: lawyerProspectFields() }, views: { create: { name: '总表', ownerId: actorId, shared: true, isDefault: true, config: {} } } }, include: { fields: true, rolePolicy: true } });
        if (target.rolePolicy) await tx.worksheetRolePolicy.create({ data: { tableId: created.id, version: 1, rules: json(remapLegacyRules(target.rolePolicy.rules, target.fields, created.fields)), invitations: target.rolePolicy.invitations! } });
        target = created;
      }
      const mapping: Record<string, 'customerNo'|'name'|'phone'|'address'|'wechat'> = {};
      const specs = [ ['客户编号','customerNo'], ['客户姓名','name'], ['联系方式','phone'], ['地区','address'], ['微信','wechat'] ] as const;
      const added: string[] = [];
      for (const [name, key] of specs) {
        let f = target.fields.find(f => !f.archived && f.name === name);
        if (f && !['TEXT','PHONE','LONG_TEXT'].includes(f.type)) throw new Error('目标基础字段类型不兼容：' + name);
        if (!f) { f = await tx.collabField.create({ data: { tableId: target.id, name, type: 'TEXT', position: target.fields.length + added.length, options: key === 'customerNo' ? { customerRouteKey: true, helpText: '按客户主表编号同步，禁止手工修改。' } : {} } }); added.push(f.id); }
        if (key === 'customerNo') await tx.collabField.update({ where: { id: f.id }, data: { options: json({ ...object(f.options), customerRouteKey: true }) } });
        mapping[f.id] = key;
      }
      for (const view of await tx.collabView.findMany({ where: { tableId: target.id, isDefault: true } })) {
        const config = object(view.config);
        if (Array.isArray(config.visibleFields)) await tx.collabView.update({ where: { id: view.id }, data: { config: json({ ...config, visibleFields: [...new Set([...config.visibleFields,...Object.keys(mapping)])] }), version: { increment: 1 } } });
      }
      await tx.collabTable.update({ where: { id: target.id }, data: { schemaVersion: { increment: 1 } } });
      routes[choices.find(c => c.name === item.name)!.id] = { targetTableId: target.id, fields: mapping };
    }
    const old = await tx.collabRule.findFirst({ where: { tableId: source.id, trigger: CUSTOMER_ROUTE_TRIGGER } });
    const data = { name: '按客户来源同步律师客资', ownerId: actorId, enabled: true, trigger: CUSTOMER_ROUTE_TRIGGER, action: json({ sourceFieldId: field.id, routes }) };
    if (old) await tx.collabRule.update({ where: { id: old.id }, data: { ...data, version: { increment: 1 } } });
    else await tx.collabRule.create({ data: { ...data, tableId: source.id } });
    for (const view of await tx.collabView.findMany({ where: { tableId: source.id, isDefault: true } })) {
      const config = object(view.config);
      if (Array.isArray(config.visibleFields)) await tx.collabView.update({ where: { id: view.id }, data: { config: json({ ...config, visibleFields: [...new Set([...config.visibleFields, field.id])] }), version: { increment: 1 } } });
    }
    await tx.collabTable.update({ where: { id: source.id }, data: { schemaVersion: { increment: 1 } } });
    for (const row of await tx.collabExtension.findMany({ where: { tableId: source.id } })) await syncCustomerSource(tx, row.recordId, actorId, source.id);
    await appendCollaborationChange(tx, actorId, source.baseId, 'customer.routing.configured', source.id);
    return report;
  }, { timeout: 30000 });
}

if (require.main === module) {
  const db = new PrismaClient();
  const [actorId, sourceTableId] = process.argv.slice(2);
  if (!actorId || !sourceTableId) throw new Error('需要管理员用户 ID 与客户主表 ID；默认只预览，--apply 执行，--replace-legacy 移除旧表并新建独立客资表');
  configureCustomerRouting(db, actorId, { sourceTableId, lawyerNames: ['刘佳律师','张恒溢律师','李辉律师'], replaceLegacyTable: process.argv.includes('--replace-legacy') }, process.argv.includes('--apply'))
    .then(report => console.log(JSON.stringify(report, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
