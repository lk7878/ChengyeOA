import { Prisma, type CasePayLine, type CaseSettlement } from '@prisma/client';
import { check } from '../../domain/workflow/schema';
import { object } from '../collaboration/collaboration-policy';
import { D } from './settlement-calculation';

type Row = CaseSettlement & { lines: CasePayLine[] };

export async function allocateRemainder(tx: Prisma.TransactionClient, row: Row, request: Record<string, unknown>) {
  const remainder = row.pool.sub(row.lines.reduce((sum, line) => sum.add(line.amount), new D(0)));
  check(!remainder.isNegative(), '成员分配合计超过可分配金额，请先调整分配');
  if (remainder.isZero()) {
    check(row.lines.length, '请先添加成员分配');
    return;
  }
  check(typeof request.leaderId === 'string' && request.remainder === remainder.toFixed(2),
    '请核对差额及接收负责人后再提交', 409);
  const member = row.teamId
    ? await tx.professionalTeamMember.findFirst({
        where: {
          professionalTeamId: row.teamId,
          employeeId: request.leaderId,
          memberRole: 'LEAD',
          startedAt: { lte: new Date() },
          endedAt: null,
          professionalTeam: { deletedAt: null, status: 'ENABLED' },
          employee: { deletedAt: null, status: { not: 'LEAVED' } },
        },
        select: { employee: { select: { id: true, name: true, employeeNo: true } } },
      })
    : request.leaderId === row.ownerEmployeeId && {
        employee: await tx.employee.findFirst({
          where: { id: row.ownerEmployeeId, deletedAt: null, status: { not: 'LEAVED' } },
          select: { id: true, name: true, employeeNo: true },
        }),
      };
  check(member && member.employee, '负责人已变更，请刷新后重新选择', 409);
  const employee = member.employee;
  const line = row.lines.find((item) => item.employeeId === employee.id);
  const note = '结算差额 +' + remainder.toFixed(2) + ' 元';
  if (line) {
    const adjustment = line.adjustment.add(remainder);
    check(adjustment.abs().lt('10000000000000000'), '负责人调整额超出范围');
    await tx.casePayLine.update({ where: { id: line.id }, data: {
      amount: line.amount.add(remainder), adjustment, reason: [line.reason, note].filter(Boolean).join('；'),
    } });
  } else {
    await tx.casePayLine.create({ data: { settlementId: row.id, employeeId: employee.id, name: employee.name,
      employeeNo: employee.employeeNo, rate: 0, adjustment: remainder, amount: remainder, reason: note } });
  }
  return { ...(row.snapshot as Prisma.JsonObject), leaderRemainder: {
    employeeId: employee.id, amount: remainder.toFixed(2), addedLine: !line, priorReason: line?.reason ?? '',
  } };
}

export async function undoRemainder(tx: Prisma.TransactionClient, row: Row) {
  const { leaderRemainder, ...snapshot } = row.snapshot as Prisma.JsonObject;
  if (!leaderRemainder) return;
  const entry = object(leaderRemainder);
  const line = row.lines.find((item) => item.employeeId === entry.employeeId);
  check(line && typeof entry.amount === 'string' && typeof entry.priorReason === 'string', '差额明细无法核对');
  if (entry.addedLine) await tx.casePayLine.delete({ where: { id: line.id } });
  else await tx.casePayLine.update({ where: { id: line.id }, data: {
    adjustment: line.adjustment.sub(entry.amount), amount: line.amount.sub(entry.amount), reason: entry.priorReason,
  } });
  return snapshot;
}
