import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { CollaborationService } from './collaboration-service';
import { boolean, choice, exact, fail, integer, json, object, text, Filter } from './collaboration-policy';

export const chartTypes = [
  'metric',
  'bar',
  'line',
  'pie',
  'ring',
  'radar',
  'funnel',
  'wordcloud',
  'sankey',
  'table',
  'kanban',
  'calendar',
  'gantt',
  'gallery',
  'area',
  'horizontal',
  'scatter',
  'combo',
] as const;
export type AnalyticsWidget = {
  id: string;
  title: string;
  type: (typeof chartTypes)[number];
  tableId: string;
  dimension?: string;
  measure?: string;
  secondary?: string;
  dateField?: string;
  endDateField?: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  filter?: Filter;
  join?: { tableId: string; localField: string; foreignField: string; mode: 'left' | 'inner' };
  width: number;
  height: number;
  color: string;
  background: string;
  decimals: number;
  legend: boolean;
};
export function widgetConfig(raw: unknown): AnalyticsWidget {
  const v = exact(raw, [
    'id',
    'title',
    'type',
    'tableId',
    'dimension',
    'measure',
    'secondary',
    'dateField',
    'endDateField',
    'aggregation',
    'filter',
    'join',
    'width',
    'height',
    'color',
    'background',
    'decimals',
    'legend',
  ]);
  const result: AnalyticsWidget = {
    id: text(v.id),
    title: text(v.title, 100),
    type: choice(v.type, chartTypes),
    tableId: text(v.tableId),
    aggregation: choice(v.aggregation, ['count', 'sum', 'avg', 'min', 'max']),
    width: integer(v.width ?? 6, 3, 12),
    height: integer(v.height ?? 320, 220, 900),
    color: String(v.color ?? '#1677ff'),
    background: String(v.background ?? '#ffffff'),
    decimals: integer(v.decimals ?? 2, 0, 6),
    legend: boolean(v.legend ?? true),
  };
  for (const key of ['dimension', 'measure', 'secondary', 'dateField', 'endDateField'] as const)
    if (v[key]) result[key] = text(v[key]);
  if (![result.color, result.background].every((c) => /^#[0-9a-f]{6}$/i.test(c)))
    fail('COLLAB_INVALID_VALUE');
  if (v.filter !== undefined) result.filter = object(v.filter) as Filter;
  if (v.join) {
    const j = exact(v.join, ['tableId', 'localField', 'foreignField', 'mode']);
    result.join = {
      tableId: text(j.tableId),
      localField: text(j.localField),
      foreignField: text(j.foreignField),
      mode: choice(j.mode, ['left', 'inner']),
    };
  }
  return result;
}
type DataRow = { id: string; values: Record<string, unknown>; displayValues?: Record<string, string> };
const numericTypes = ['NUMBER', 'CURRENCY', 'FORMULA', 'AUTONUMBER'];
export const valueLabel = (v: unknown): string =>
  v == null || v === ''
    ? '未填写'
    : Array.isArray(v)
      ? v.map(valueLabel).join('、')
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);

export class AnalyticsService {
  readonly tables: CollaborationService;
  constructor(
    readonly db: PrismaClient,
    readonly actor: AuthorizationContext,
  ) {
    this.tables = new CollaborationService(db, actor);
  }
  async sources() {
    const candidates = await this.db.collabTable.findMany({
      where: { archived: false },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    const sources: Array<{ id: string; name: string; baseId: string; baseName: string; fields: unknown[] }> =
      [];
    for (const candidate of candidates) {
      try {
        const d = await this.tables.describe(candidate.id);
        if (d.access.analytics === false) continue;
        const base = await this.db.collabBase.findUniqueOrThrow({
          where: { id: d.table.baseId },
          select: { name: true },
        });
        sources.push({
          id: d.table.id,
          name: d.table.name,
          baseId: d.table.baseId,
          baseName: base.name,
          fields: d.fields
            .filter((f) => f.queryable)
            .map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options })),
        });
      } catch (e) {
        if (![403, 404].includes((e as { status: number }).status)) throw e;
      }
    }
    return sources;
  }
  private async read(tableId: string, filter?: Filter) {
    const detail = await this.tables.describe(tableId);
    if (detail.access.analytics === false) fail('COLLAB_FORBIDDEN',403);
    const fields = detail.fields.filter((f) => f.queryable);
    const records: DataRow[] = [];
    // Use the grid's canonical projections, masking and row ACL; never query raw business rows.
    for (let page = 1; ; page++) {
      const data = await this.tables.query(tableId, {
        page,
        pageSize: 200,
        config: { ...(filter ? { filter } : {}), visibleFields: fields.map((f) => f.id) },
      });
      if (data.total > 10000) fail('ANALYTICS_DATA_LIMIT');
      records.push(...(data.records as DataRow[]));
      if (records.length >= data.total || !data.records.length) break;
    }
    return { detail, fields, records };
  }
  async query(raw: unknown) {
    return this.db.$transaction(
      (tx) => new AnalyticsService(tx as PrismaClient, this.actor).querySnapshot(raw),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 },
    );
  }
  private async querySnapshot(raw: unknown) {
    const w = widgetConfig(raw);
    if (
      (['calendar', 'gantt'].includes(w.type) && !w.dateField) ||
      (w.type === 'gantt' && !w.endDateField) ||
      (['kanban', 'sankey', 'radar'].includes(w.type) && !w.dimension) ||
      (w.type === 'sankey' && !w.secondary)
    )
      fail('ANALYTICS_CONFIG_REQUIRED');
    const primary = await this.read(w.tableId, w.filter);
    let fields = primary.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options }));
    let records = primary.records.map((r) => ({
      ...r,
      values: Object.fromEntries(fields.map((f) => [f.id, r.values[f.id]])),
    }));
    const field = (id: string | undefined) => {
      const f = fields.find((f) => f.id === id);
      if (!f) fail('COLLAB_FIELD_UNAVAILABLE', 403);
      return f;
    };
    if (w.join) {
      const j = w.join;
      if (j.localField !== '$recordId') field(j.localField);
      const related = await this.read(j.tableId);
      if (j.foreignField !== '$recordId' && !related.fields.some((f) => f.id === j.foreignField))
        fail('COLLAB_FIELD_UNAVAILABLE', 403);
      const keys = (v: unknown) =>
        v == null || v === '' ? [] : (Array.isArray(v) ? v : [v]).map((x) => JSON.stringify(x));
      const index = new Map<string, DataRow[]>();
      for (const row of related.records)
        for (const key of keys(j.foreignField === '$recordId' ? row.id : row.values[j.foreignField]))
          index.set(key, [...(index.get(key) || []), row]);
      fields = [
        ...fields,
        ...related.fields.map((f) => ({
          id: 'related:' + f.id,
          name: '关联 · ' + f.name,
          type: f.type,
          options: f.options,
        })),
      ];
      const joined: typeof records = [];
      for (const row of records) {
        const matches = [
          ...new Map(
            keys(j.localField === '$recordId' ? row.id : row.values[j.localField])
              .flatMap((k) => index.get(k) || [])
              .map((r) => [r.id, r]),
          ).values(),
        ];
        if (!matches.length && j.mode === 'left') joined.push(row);
        if (joined.length + matches.length > 10000) fail('ANALYTICS_DATA_LIMIT');
        joined.push(
          ...matches.map((m) => ({
            ...row,
            values: {
              ...row.values,
              ...Object.fromEntries(related.fields.map((f) => ['related:' + f.id, m.values[f.id]])),
            },
            displayValues: {
              ...row.displayValues,
              ...Object.fromEntries(
                Object.entries(m.displayValues || {}).map(([k, v]) => ['related:' + k, v]),
              ),
            },
          })),
        );
      }
      records = joined;
      if (records.length > 10000) fail('ANALYTICS_DATA_LIMIT');
    }
    for (const id of [w.dimension, w.secondary, w.dateField, w.endDateField, w.measure]) if (id) field(id);
    if (w.aggregation !== 'count' && (!w.measure || !numericTypes.includes(field(w.measure).type)))
      fail('ANALYTICS_NUMERIC_REQUIRED');
    const label = (r: DataRow, id?: string) => {
      if (!id) return '全部';
      const f = field(id);
      const choices = object(f.options).choices;
      const option = Array.isArray(choices) ? choices.find((c) => object(c).id === r.values[id]) : null;
      return r.displayValues?.[id] || (option ? String(object(option).name) : valueLabel(r.values[id]));
    };
    const aggregate = (rows: DataRow[]) => {
      if (w.aggregation === 'count') return String(rows.length);
      const numbers = rows
        .map((r) => r.values[w.measure!])
        .filter((v) => v !== null && v !== undefined && v !== '' && /^-?\d+(\.\d+)?$/.test(String(v)))
        .map((v) => new Prisma.Decimal(String(v)));
      if (!numbers.length) return '0';
      if (w.aggregation === 'min') return Prisma.Decimal.min(...numbers).toString();
      if (w.aggregation === 'max') return Prisma.Decimal.max(...numbers).toString();
      const sum = numbers.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
      return (w.aggregation === 'avg' ? sum.div(numbers.length) : sum).toString();
    };
    const groups = new Map<string, { key: string; target: string; rows: DataRow[] }>();
    for (const row of records) {
      const key = label(row, w.dimension),
        target = w.secondary ? label(row, w.secondary) : '';
      const id = JSON.stringify([key, target]);
      if (!groups.has(id)) groups.set(id, { key, target, rows: [] });
      groups.get(id)!.rows.push(row);
    }
    const series = [...groups.values()].map((g) => ({
      key: g.key,
      target: g.target,
      value: aggregate(g.rows),
      count: g.rows.length,
    }));
    return {
      fields,
      records: records.map((r) => ({
        id: r.id,
        values: r.values,
        labels: Object.fromEntries(fields.map((f) => [f.id, label(r, f.id)])),
      })),
      series,
      metric: aggregate(records),
      total: records.length,
      baseId: primary.detail.table.baseId,
      tableId: w.tableId,
      updatedAt: new Date().toISOString(),
    };
  }
  async list() {
    return this.db.analyticsDashboard.findMany({
      where: { OR: [{ ownerId: this.actor.userId }, { shared: true }] },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async save(raw: unknown, id?: string) {
    const input = exact(raw, ['name', 'shared', 'widgets', 'refreshSeconds', 'version']);
    const name = text(input.name, 100),
      shared = boolean(input.shared ?? false),
      refreshSeconds = integer(input.refreshSeconds ?? 0, 0, 3600);
    if (refreshSeconds !== 0 && refreshSeconds < 30) fail('COLLAB_INVALID_NUMBER');
    if (!Array.isArray(input.widgets) || input.widgets.length > 30) fail('ANALYTICS_WIDGET_LIMIT');
    const widgets = input.widgets.map(widgetConfig);
    if (new Set(widgets.map((w) => w.id)).size !== widgets.length) fail('COLLAB_INVALID_VALUE');
    // Validate accessible bindings and all query fields before saving a usable board.
    for (const widget of widgets) await this.query(widget);
    return this.db.$transaction(async (tx) => {
      let result;
      if (id) {
        const count = await tx.analyticsDashboard.updateMany({
          where: { id, ownerId: this.actor.userId, version: integer(input.version) },
          data: { name, shared, widgets: json(widgets), refreshSeconds, version: { increment: 1 } },
        });
        if (!count.count) fail('ANALYTICS_CONFLICT', 409);
        result = await tx.analyticsDashboard.findUniqueOrThrow({ where: { id } });
      } else
        result = await tx.analyticsDashboard.create({
          data: { name, shared, widgets: json(widgets), refreshSeconds, ownerId: this.actor.userId },
        });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'ANALYTICS_DASHBOARD_SAVE',
          targetType: 'ANALYTICS_DASHBOARD',
          targetId: result.id,
          newValues: JSON.stringify({ name, shared, widgets: widgets.length }),
        },
      });
      return result;
    });
  }
  async remove(id: string, version: unknown) {
    await this.db.$transaction(async (tx) => {
      const result = await tx.analyticsDashboard.deleteMany({
        where: { id, ownerId: this.actor.userId, version: integer(version) },
      });
      if (!result.count) fail('ANALYTICS_CONFLICT', 409);
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'ANALYTICS_DASHBOARD_DELETE',
          targetType: 'ANALYTICS_DASHBOARD',
          targetId: id,
        },
      });
    });
    return { deleted: true };
  }
}
