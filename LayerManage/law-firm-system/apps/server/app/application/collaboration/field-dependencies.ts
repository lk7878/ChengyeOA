import { CollabField, Prisma } from '@prisma/client';
import { object } from './collaboration-policy';
type Tx = Prisma.TransactionClient;
const references = (value: unknown, id: string) => JSON.stringify(value ?? {}).includes(id);

export async function fieldDependencies(tx: Tx, tableId: string, field: CollabField) {
    const dependencies: string[] = [];
    const views = await tx.collabView.findMany({ where: { tableId } });
    for (const view of views) {
      const { visibleFields: _visible, widths: _widths, ...logic } = object(view.config);
      void _visible; void _widths;
      if (references(logic, field.id)) dependencies.push('视图「' + view.name + '」的筛选、排序、分组或日历设置');
    }
    // Also inspect inactive rules/fields: restoring them must not create dangling references.
    const rules = await tx.collabRule.findMany({ where: { tableId } });
    for (const rule of rules) if (references([rule.condition, rule.action], field.id)) dependencies.push('自动化规则「' + rule.name + '」');
    const fields = await tx.collabField.findMany({ where: { id: { not: field.id } }, include: { table: { select: { name: true } } } });
    for (const f of fields) {
      const formula = String(object(f.options).formula || '');
      if (references(f.options, field.id) || formula && formula.includes(field.name)) dependencies.push(f.tableId === tableId ? '字段「' + f.name + '」的公式或关联' : '其他数据表存在公式或关联，请联系相关表管理员处理');
    }
    // Policies, approval forms and dashboards may hold field identifiers in JSON.
    const checks = [
      ['worksheet_role_policy', 'rules', '工作表角色字段授权'], ['worksheet_role_policy', 'invitations', '工作表成员字段授权'],
      ['collab_table', 'accessPolicy', '表格字段授权'], ['collab_base', 'accessPolicy', '应用字段授权'],
      ['drive_node', 'accessPolicy', '目录字段授权'], ['approval_definition', 'formSchema', '审批表单'],
      ['approval_definition', 'nodeSchema', '审批节点'], ['approval_instance', 'content', '审批记录'],
      ['analytics_dashboard', 'widgets', '数据分析图表'],
    ];
    for (const [table, column, label] of checks) {
      // SQL identifiers are a fixed allowlist, never user input.
      const found = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM ${Prisma.raw('"' + table + '"')} WHERE strpos(${Prisma.raw('"' + column + '"')}::text, ${field.id}) > 0`);
      if (Number(found[0].n)) dependencies.push(label + '（' + found[0].n + ' 项）');
    }
    const members = await tx.collabMember.count({ where: { OR: [{ hiddenFields: { has: field.id } }, { readonlyFields: { has: field.id } }] } });
    if (members) dependencies.push('工作区成员字段授权');
    if (field.type === 'FILE') {
      // Keep storage deletion in the attachment workflow so shared blobs cannot be removed by a column operation.
      const files = await tx.collabAttachment.count({ where: { tableId } });
      if (files) dependencies.push('本表仍有附件，请先通过附件管理清理或迁移，避免丢失文件引用');
    }
    return dependencies;
  }
