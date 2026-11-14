import { CollabField, CollabTable, Prisma } from '@prisma/client';
import { fail, object } from './collaboration-policy';

export const caseArchiveKinds = ['CASE_ARCHIVE_REVIEW', 'CASE_ARCHIVE_REGISTER', 'CASE_ARCHIVE_OFFLINE'] as const;
export type CaseArchiveKind = typeof caseArchiveKinds[number];
export const isCaseArchiveKind = (kind: unknown): kind is CaseArchiveKind =>
  caseArchiveKinds.includes(kind as CaseArchiveKind);
export const caseArchiveNames: Record<CaseArchiveKind, string> = {
  CASE_ARCHIVE_REVIEW: '案件归档审核',
  CASE_ARCHIVE_REGISTER: '案卷档案登记表',
  CASE_ARCHIVE_OFFLINE: '案卷档案登记表(不上传法网)',
};
export const caseArchiveAliases = (kind: CaseArchiveKind) => [caseArchiveNames[kind],
  ...(kind === 'CASE_ARCHIVE_OFFLINE' ? ['案卷档案登记表（不上传法网）'] : []),
];
type Spec = [name: string, type: string, required?: boolean];
const review: Spec[] = [
  ['序号', 'AUTONUMBER'], ['审理时间', 'DATETIME', true], ['合同编号', 'TEXT', true],
  ['当事人', 'TEXT', true], ['案件类型', 'TEXT', true], ['问题', 'LONG_TEXT'],
  ['是否盖章归档', 'SINGLE_SELECT', true], ['质保金是否签字', 'SINGLE_SELECT', true], ['质保金结算凭证', 'FILE'],
];
// The supplied detailed lists contain twelve fields, including the final 备注 column.
const register: Spec[] = [
  ['序号', 'AUTONUMBER'], ['归档时间', 'DATETIME', true], ['编号', 'TEXT'], ['类型', 'TEXT', true],
  ['档号', 'TEXT', true], ['案由', 'TEXT', true], ['当事人', 'TEXT', true], ['律师', 'TEXT', true],
  ['合同编号', 'TEXT'], ['档案盒号', 'TEXT'], ['柜号', 'TEXT'], ['备注', 'TEXT'],
];
export function caseArchiveFields(kind: CaseArchiveKind) {
  return (kind === 'CASE_ARCHIVE_REVIEW' ? review : register).map(([name, type, required = false], position) => ({
    name, type, required, position, defaultValue: Prisma.DbNull,
    options: {
      inventoryKey: name,
      ...(position === 0 ? { primary: true } : {}),
      ...(type === 'DATETIME' ? { dateOnly: true } : {}),
      ...(type === 'SINGLE_SELECT' ? { choices: (name === '质保金是否签字' ? ['是', '否', '不涉及'] : ['是', '否']).map(value => ({ id: value, name: value })) } : {}),
      ...(name === '合同编号' ? { helpText: '填写对应合同编号，保留原编号格式；此表的修改不会自动改变合同或案件状态。' } : {}),
      ...(name === '类型' ? { helpText: '例如：民事、刑事、行政、非诉、顾问。' } : {}),
      ...(name === '档号' ? { helpText: '同一登记表内不可重复；删除后可重新使用，恢复时重新校验。' } : {}),
    } as Prisma.InputJsonObject,
  }));
}

/** The table lock is also taken before row locks in mutation/restore to avoid lock-order inversion. */
export async function validateCaseArchiveRecord(tx: Prisma.TransactionClient, table: CollabTable,
  fields: CollabField[], values: Record<string, unknown>, recordId?: string) {
  if (!isCaseArchiveKind(table.inventoryKind) || table.inventoryKind === 'CASE_ARCHIVE_REVIEW') return;
  await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${table.id} FOR UPDATE`;
  const field = fields.find(f => !f.archived && object(f.options).inventoryKey === '档号');
  if (!field) return;
  const number = values[field.id];
  if (number === null || number === undefined || number === '') return;
  if (await tx.collabRecord.findFirst({ where: {
    tableId: table.id, archived: false, ...(recordId ? { id: { not: recordId } } : {}),
    values: { path: [field.id], equals: String(number).trim() },
  }, select: { id: true } })) fail('COLLAB_ARCHIVE_NUMBER_DUPLICATE', 409, { fieldId: field.id });
}
