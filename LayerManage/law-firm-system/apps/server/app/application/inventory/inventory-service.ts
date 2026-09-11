import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuditActor } from '../master-data/master-data-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeAllowedValue, normalizeOptionalText, normalizeRequiredText, normalizeVersion, parseIsoDate } from '../../domain/master-data/master-data-validation';

const KINDS = ['CUSTOMIZED', 'OFFICE'] as const;
const ACTIONS = ['INBOUND', 'OUTBOUND', 'ADJUST'] as const;
const MAX_QUANTITY = new Prisma.Decimal('999999999999999.999');
type Db = Prisma.TransactionClient;
const fail = (code: string, status = 400): never => { throw new MasterDataError(code, status); };
const no = (prefix: string) => prefix + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
function quantity(value: unknown, zero = true) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,15}(\.\d{1,3})?$/.test(String(value))) fail('INVENTORY_QUANTITY_INVALID');
  const q = new Prisma.Decimal(String(value));
  if ((!zero && q.lte(0)) || q.gt(MAX_QUANTITY)) fail('INVENTORY_QUANTITY_INVALID');
  return q;
}
function businessDate(value: unknown): Date {
  const date = normalizeRequiredText(value, 10, 10); parseIsoDate(date);
  return new Date(date + 'T00:00:00+08:00');
}
function period(query: Record<string, unknown>) {
  const from = query.from ? businessDate(query.from) : undefined;
  const end = query.to ? businessDate(query.to) : undefined;
  if (from && end && from > end) fail('VALIDATION_FAILED');
  return from || end ? { gte: from, lt: end ? new Date(end.getTime() + 86400000) : undefined } : undefined;
}
function pageQuery(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('VALIDATION_FAILED');
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
async function orgPath(db: Db, id: string | null) {
  const names: string[] = [], seen = new Set<string>();
  while (id && !seen.has(id) && seen.size < 50) {
    seen.add(id); const org = await db.organization.findUnique({ where: { id }, select: { name: true, parentId: true } });
    if (!org) break; names.unshift(org.name); id = org.parentId;
  }
  return names.join('/');
}
export class InventoryService {
  private auth = new AuthorizationService();
  constructor(private prisma: PrismaClient, private actor: AuditActor, private context: AuthorizationContext) {}
  private async audit(tx: Db, action: string, id: string, data: Record<string, unknown>) {
    await tx.operationLog.create({ data: { userId: this.actor.actorUserId, action, targetType: 'INVENTORY', targetId: id, newValues: JSON.stringify(data), ip: this.actor.ip } });
  }
  async saveItem(input: unknown, id?: string) {
    this.auth.requireAction(this.context, 'inventory.manage');
    assertExactKeys(input, ['name', 'kind', 'category', 'unit', 'specification', 'location', 'minimumStock', 'status', 'version']);
    const data = { name: normalizeRequiredText(input.name, 1, 100), kind: normalizeAllowedValue(input.kind, KINDS), category: normalizeRequiredText(input.category, 1, 100), unit: normalizeRequiredText(input.unit, 1, 20), specification: normalizeOptionalText(input.specification, 100), location: normalizeOptionalText(input.location, 100), minimumStock: quantity(input.minimumStock ?? 0), status: normalizeAllowedValue(input.status ?? 'ENABLED', ['ENABLED', 'DISABLED']) };
    return this.prisma.$transaction(async tx => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM inventory_item WHERE id = ${id} FOR UPDATE`;
        const old = await tx.inventoryItem.findUnique({ where: { id } });
        if (!old) fail('INVENTORY_NOT_FOUND', 404);
        if (old.version !== normalizeVersion(input.version)) fail('VERSION_CONFLICT', 409);
        if ((old.unit !== data.unit || old.kind !== data.kind) && (await tx.inventoryMovement.count({ where: { itemId: id } }) || await tx.inventoryStocktake.count({ where: { itemId: id } }))) fail('INVENTORY_UNIT_FROZEN', 409);
      }
      const row = id ? await tx.inventoryItem.update({ where: { id }, data: { ...data, version: { increment: 1 } } }) : await tx.inventoryItem.create({ data: { ...data, code: no('WP'), createdBy: this.actor.actorUserId } });
      await this.audit(tx, id ? 'INVENTORY_ITEM_UPDATE' : 'INVENTORY_ITEM_CREATE', row.id, { version: row.version, status: row.status });
      return row;
    });
  }
  async recipients(keyword?: string) {
    this.auth.requireAction(this.context, 'inventory.outbound');
    const search = normalizeOptionalText(keyword, 100);
    const rows = await this.prisma.employee.findMany({ where: { deletedAt: null, status: { not: 'LEAVED' }, ...(search ? { OR: [{ name: { contains: search } }, { employeeNo: { contains: search } }] } : {}) }, select: { id: true, name: true, employeeNo: true, assignments: { where: { assignmentType: 'PRIMARY', endedAt: null }, select: { organizationId: true } } }, take: 50, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return Promise.all(rows.map(async row => ({ id: row.id, name: row.name, employeeNo: row.employeeNo, organizationPath: await orgPath(this.prisma, row.assignments[0]?.organizationId ?? null) })));
  }
  async move(input: unknown) {
    assertExactKeys(input, ['itemId', 'action', 'quantity', 'employeeId', 'source', 'reason', 'occurredAt', 'version', 'idempotencyKey']);
    const action = normalizeAllowedValue(input.action, ['INBOUND', 'OUTBOUND']);
    this.auth.requireAction(this.context, action === 'INBOUND' ? 'inventory.inbound' : 'inventory.outbound');
    const itemId = normalizeRequiredText(input.itemId, 1, 100), q = quantity(input.quantity, false), version = normalizeVersion(input.version), occurredAt = businessDate(input.occurredAt);
    const employeeId = action === 'OUTBOUND' ? normalizeRequiredText(input.employeeId, 1, 100) : null;
    if (action === 'INBOUND' && input.employeeId) fail('VALIDATION_FAILED');
    const source = normalizeOptionalText(input.source, 200), reason = normalizeOptionalText(input.reason, 500);
    if (action === 'OUTBOUND' && !reason) fail('INVENTORY_REASON_REQUIRED');
    const requestKey = this.key(action, input.idempotencyKey), requestHash = createHash('sha256').update(JSON.stringify({ itemId, action, quantity: q.toFixed(3), version, occurredAt, employeeId, source, reason })).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))::text`;
      const existing = await tx.inventoryMovement.findUnique({ where: { requestKey } });
      if (existing) { if (existing.requestHash !== requestHash) fail('INVENTORY_KEY_CONFLICT', 409); return existing; }
      const item = await this.lockItem(tx, itemId, version);
      const signed = action === 'OUTBOUND' ? q.negated() : q, afterStock = item.stock.plus(signed);
      if (afterStock.lt(0)) fail('INVENTORY_INSUFFICIENT', 409);
      if (afterStock.gt(MAX_QUANTITY)) fail('INVENTORY_QUANTITY_INVALID');
      let employeeName: string | null = null, organizationId: string | null = null, organizationPath: string | null = null;
      if (employeeId) {
        await tx.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId} FOR SHARE`;
        const employee = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null, status: { not: 'LEAVED' } }, select: { name: true, assignments: { where: { assignmentType: 'PRIMARY', endedAt: null }, select: { organizationId: true } } } });
        if (!employee || employee.assignments.length !== 1) fail('INVENTORY_RECIPIENT_INVALID');
        employeeName = employee.name; organizationId = employee.assignments[0].organizationId; organizationPath = await orgPath(tx, organizationId);
      }
      const row = await tx.inventoryMovement.create({ data: { requestKey, requestHash, documentNo: no(action === 'INBOUND' ? 'RK' : 'CK'), itemId, itemKind: item.kind, itemName: item.name, itemSpecification: item.specification, unit: item.unit, action, quantity: signed, beforeStock: item.stock, afterStock, employeeId, employeeName, organizationId, organizationPath, source, reason, occurredAt, createdBy: this.actor.actorUserId } });
      await tx.inventoryItem.update({ where: { id: itemId }, data: { stock: afterStock, version: { increment: 1 } } });
      await this.audit(tx, 'INVENTORY_' + action, row.id, { itemId, quantity: signed.toFixed(3), employeeId });
      return row;
    });
  }
  async stocktake(input: unknown) {
    this.auth.requireAction(this.context, 'inventory.stocktake');
    assertExactKeys(input, ['itemId', 'actualStock', 'reason', 'occurredAt', 'version', 'idempotencyKey']);
    const itemId = normalizeRequiredText(input.itemId, 1, 100), actualStock = quantity(input.actualStock), reason = normalizeOptionalText(input.reason, 500), occurredAt = businessDate(input.occurredAt), version = normalizeVersion(input.version);
    const requestKey = this.key('STOCKTAKE', input.idempotencyKey), requestHash = createHash('sha256').update(JSON.stringify({ itemId, actualStock: actualStock.toFixed(3), reason, occurredAt, version })).digest('hex');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))::text`;
      const existing = await tx.inventoryStocktake.findUnique({ where: { requestKey } });
      if (existing) { if (existing.requestHash !== requestHash) fail('INVENTORY_KEY_CONFLICT', 409); return existing; }
      const item = await this.lockItem(tx, itemId, version), difference = actualStock.minus(item.stock);
      if (!difference.isZero() && !reason) fail('INVENTORY_REASON_REQUIRED');
      const row = await tx.inventoryStocktake.create({ data: { requestKey, requestHash, documentNo: no('PD'), itemId, itemName: item.name, unit: item.unit, bookStock: item.stock, actualStock, difference, reason, occurredAt, createdBy: this.actor.actorUserId } });
      if (!difference.isZero()) await tx.inventoryMovement.create({ data: { requestKey, requestHash, documentNo: row.documentNo, itemId, itemKind: item.kind, itemName: item.name, itemSpecification: item.specification, unit: item.unit, action: 'ADJUST', quantity: difference, beforeStock: item.stock, afterStock: actualStock, reason, occurredAt, createdBy: this.actor.actorUserId } });
      await tx.inventoryItem.update({ where: { id: itemId }, data: { stock: actualStock, version: { increment: 1 } } });
      await this.audit(tx, 'INVENTORY_STOCKTAKE', row.id, { itemId, difference: difference.toFixed(3) });
      return row;
    });
  }
  private key(action: string, value: unknown) { return createHash('sha256').update(this.actor.actorUserId + ':' + action + ':' + normalizeRequiredText(value, 1, 100)).digest('hex'); }
  private async lockItem(tx: Db, id: string, version: number) {
    await tx.$queryRaw`SELECT id FROM inventory_item WHERE id = ${id} FOR UPDATE`;
    const item = await tx.inventoryItem.findUnique({ where: { id } });
    if (!item) fail('INVENTORY_NOT_FOUND', 404);
    if (item.status !== 'ENABLED') fail('INVENTORY_DISABLED', 409);
    if (item.version !== version) fail('VERSION_CONFLICT', 409);
    return item;
  }
  private filters(query: unknown) {
    assertExactKeys(query, ['view', 'kind', 'action', 'keyword', 'from', 'to', 'page', 'pageSize', 'itemId', 'employeeId', 'organizationId', 'groupBy', 'status']);
    const view = normalizeAllowedValue(query.view ?? 'items', ['items', 'movements', 'stocktakes', 'statistics', 'dashboard']);
    const kind = query.kind ? normalizeAllowedValue(query.kind, KINDS) : undefined;
    const keyword = normalizeOptionalText(query.keyword, 100);
    const itemId = normalizeOptionalText(query.itemId, 100), employeeId = normalizeOptionalText(query.employeeId, 100), organizationId = normalizeOptionalText(query.organizationId, 100);
    const occurredAt = period(query);
    const items: Prisma.InventoryItemWhereInput = { ...(kind ? { kind } : {}), ...(itemId ? { id: itemId } : {}), ...(query.status ? { status: normalizeAllowedValue(query.status, ['ENABLED', 'DISABLED']) } : {}), ...(keyword ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }, { category: { contains: keyword } }] } : {}) };
    const movements: Prisma.InventoryMovementWhereInput = { ...(kind ? { itemKind: kind } : {}), ...(itemId ? { itemId } : {}), ...(employeeId ? { employeeId } : {}), ...(organizationId ? { organizationId } : {}), ...(occurredAt ? { occurredAt } : {}), ...(query.action ? { action: normalizeAllowedValue(query.action, ACTIONS) } : {}), ...(keyword ? { OR: [{ itemName: { contains: keyword } }, { item: { code: { contains: keyword } } }, { documentNo: { contains: keyword } }, { employeeName: { contains: keyword } }, { organizationPath: { contains: keyword } }] } : {}) };
    const stocktakes: Prisma.InventoryStocktakeWhereInput = { ...(kind ? { item: { kind } } : {}), ...(itemId ? { itemId } : {}), ...(occurredAt ? { occurredAt } : {}), ...(keyword ? { OR: [{ itemName: { contains: keyword } }, { item: { code: { contains: keyword } } }, { documentNo: { contains: keyword } }] } : {}) };
    const groupBy = normalizeAllowedValue(query.groupBy ?? 'item', ['item', 'employee', 'organization']);
    return { view, items, movements, stocktakes, groupBy, ...pageQuery(query) };
  }
  async list(query: unknown, exporting = false) {
    this.auth.requireAction(this.context, 'inventory.read');
    if (exporting) this.auth.requireAction(this.context, 'inventory.export');
    const f = this.filters(query), skip = exporting ? 0 : f.skip, take = exporting ? 10001 : f.take;
    if (f.view === 'dashboard') return this.dashboard(f.items, f.movements);
    if (f.view === 'statistics') return this.statistics(f.movements, f.groupBy, skip, take);
    if (f.view === 'items') {
      const [total, list] = await this.prisma.$transaction([this.prisma.inventoryItem.count({ where: f.items }), this.prisma.inventoryItem.findMany({ where: f.items, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take })]);
      return { total, list: await this.present(list), page: f.page, pageSize: f.pageSize };
    }
    if (f.view === 'stocktakes') {
      const [total, list] = await this.prisma.$transaction([this.prisma.inventoryStocktake.count({ where: f.stocktakes }), this.prisma.inventoryStocktake.findMany({ where: f.stocktakes, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip, take })]);
      return { total, list: await this.present(list), page: f.page, pageSize: f.pageSize };
    }
    const [total, list] = await this.prisma.$transaction([this.prisma.inventoryMovement.count({ where: f.movements }), this.prisma.inventoryMovement.findMany({ where: f.movements, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip, take })]);
    return { total, list: await this.present(list), page: f.page, pageSize: f.pageSize };
  }
  private async present<T extends { createdBy: string }>(rows: T[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.createdBy))] } }, select: { id: true, username: true, employee: { select: { name: true } } } });
    const names = new Map(users.map(u => [u.id, u.employee?.name || u.username]));
    return rows.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'requestKey' && key !== 'requestHash')) as Omit<T, 'requestKey' | 'requestHash'>, createdByName: names.get(row.createdBy) || '系统登记' }));
  }
  private async statistics(where: Prisma.InventoryMovementWhereInput, groupBy: string, skip: number, take: number) {
    const by: Array<'itemId' | 'unit' | 'employeeId' | 'organizationId'> = ['itemId', 'unit', ...(groupBy === 'employee' ? ['employeeId'] as const : groupBy === 'organization' ? ['organizationId'] as const : [])];
    const groups = await this.prisma.inventoryMovement.groupBy({ by, where: { ...where, action: 'OUTBOUND' }, _sum: { quantity: true }, _count: { _all: true }, orderBy: [{ _sum: { quantity: 'asc' } }, { itemId: 'asc' }] });
    const page = groups.slice(skip, skip + take);
    const [items, employees, organizations] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { id: { in: page.map(r => r.itemId) } }, select: { id: true, name: true } }),
      this.prisma.employee.findMany({ where: { id: { in: page.flatMap(r => r.employeeId ? [r.employeeId] : []) } }, select: { id: true, name: true } }),
      Promise.all([...new Set(page.flatMap(r => r.organizationId ? [r.organizationId] : []))].map(async id => [id, await orgPath(this.prisma, id)] as const)),
    ]);
    const names = new Map(items.map(r => [r.id, r.name])), people = new Map(employees.map(r => [r.id, r.name])), paths = new Map(organizations);
    return { total: groups.length, list: page.map(row => ({ id: [row.itemId, row.unit, row.employeeId, row.organizationId].join(':'), itemName: names.get(row.itemId), unit: row.unit, employeeName: row.employeeId ? people.get(row.employeeId) : null, organizationPath: row.organizationId ? paths.get(row.organizationId) : null, quantity: row._sum.quantity?.abs().toFixed(3) ?? '0', count: row._count._all })) };
  }
  private async dashboard(items: Prisma.InventoryItemWhereInput, movements: Prisma.InventoryMovementWhereInput) {
    const [itemCount, lowStockCount, inboundCount, outboundCount, top] = await Promise.all([
      this.prisma.inventoryItem.count({ where: items }),
      this.prisma.inventoryItem.count({ where: { AND: [items, { status: 'ENABLED', stock: { lte: this.prisma.inventoryItem.fields.minimumStock } }] } }),
      this.prisma.inventoryMovement.count({ where: { ...movements, action: 'INBOUND' } }),
      this.prisma.inventoryMovement.count({ where: { ...movements, action: 'OUTBOUND' } }),
      this.statistics(movements, 'item', 0, 10),
    ]);
    return { itemCount, lowStockCount, inboundCount, outboundCount, top: top.list };
  }
  async export(query: unknown) {
    this.auth.requireAction(this.context, 'inventory.export');
    const result = await this.list(query, true);
    if (!('list' in result) || !Array.isArray(result.list)) return fail('VALIDATION_FAILED');
    if (result.total > 10000) fail('INVENTORY_EXPORT_TOO_LARGE');
    const columns: Record<string, string> = { code: '物品编码', documentNo: '单据编号', name: '物品名称', itemName: '物品名称', kind: '物品类型', itemKind: '物品类型', category: '分类', specification: '规格', itemSpecification: '规格', unit: '单位', location: '位置', stock: '库存', minimumStock: '预警下限', status: '状态', action: '操作类型', quantity: '数量', beforeStock: '操作前库存', afterStock: '操作后库存', employeeName: '领用人', organizationPath: '领用组织', source: '来源/供应商', reason: '用途/原因', occurredAt: '业务日期', bookStock: '账面库存', actualStock: '实盘数量', difference: '盘点差异', count: '领用笔数', createdByName: '经办人' };
    const records = result.list as unknown as Array<Record<string, unknown>>;
    const keys = records.length ? Object.keys(columns).filter(key => records.some(row => key in row)) : ['name', 'unit', 'quantity'];
    const labels: Record<string, string> = { OFFICE: '办公用品', CUSTOMIZED: '定制物品', INBOUND: '入库', OUTBOUND: '领用出库', ADJUST: '盘点调整', ENABLED: '启用', DISABLED: '停用' };
    const lines = [keys.map(key => csvCell(columns[key])).join(','), ...records.map(row => keys.map(key => csvCell(row[key] instanceof Date ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(row[key] as Date) : labels[String(row[key])] ?? row[key])).join(','))];
    await this.audit(this.prisma, 'INVENTORY_EXPORT', 'ledger', { rowCount: records.length });
    return { fileName: '物品管理台账.csv', csv: '\uFEFF' + lines.join('\r\n') };
  }
}
function csvCell(value: unknown) { let text = value === null || value === undefined ? '' : String(value); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; }
