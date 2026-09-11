// SPEC-011 Task 9: anomaly-service —— FIN-05 四口径异常台账（纯只读查询）。
// 四口径（设计 §5 呈现稿/FTN + 协调者裁决，查询逐字钉死）：signed-unpaid /
// received-uninvoiced / first-sign-no-formal / paid-no-case。
// 纪律（协调者裁决 5）：零事务/零事件/零审计/零 outbox——本服务为纯读路径，
// 构造 (prisma, actor, authorizationContext)（actor 保留供 Task 10/11 工厂同构注入，
// 本服务不使用——纯读无审计）。每公开方法形态逐段镜像 listPayments（receivable-service.ts:596）：
//   requireAction('anomaly.read') 首行 → assertExactKeys(query, ['page','pageSize']) →
//   normalizePage/pageSize（默认 1/20，上限 100，非法 VALIDATION_FAILED 400）→
//   buildScopeWhere('anomaly.read')（resource 传 'anomaly'——S15 双键：与
//   permission-catalog anomaly.read 的 resource 逐字一致，错传 'contract' 则
//   ('contract','anomaly.read') 恒空集 fail-closed）→ count+findMany 信封分页
//   （createdAt DESC id ASC 决胜）。
// 全口径 scope + deletedAt null：where 首项 { AND: [contract 级 scopeWhere, { deletedAt: null }, …口径条件] }
//   （Contract 查询形态，非 { contract: … } 关系包裹——沿 listContracts 先例）。
// 四口径：
//   1. signed-unpaid：{ status: { in: ['SIGNED','EFFECTIVE'] }, receivedAmount: 0 }，
//      gapAmount null。
//   2. received-uninvoiced：{ receivedAmount: { gt: 0 } } + 页级聚合——scope 过滤后先取
//      当页 contractId 集合，invoiceRequest.groupBy({ by:['contractId'], where:
//      { contractId: { in: pageIds }, status: 'COMPLETED' }, _sum: { amount: true } })，
//      内存过滤 receivedAmount > invoicedSum，重组分页（页内条数可 < pageSize——测试钉
//      口径正确性而非页满）；gapAmount = receivedAmount − invoicedSum（toFixed(2)）。
//      total 取候选池 count（scope+receivedAmount>0+未删）——页级过滤无法在常数页上
//      推导全量过滤后总数，故 total 为候选池规模、list 为当页过滤后子集（页级过滤
//      语义，协调者裁决认可页内条数 < pageSize）。
//   3. first-sign-no-formal：{ contractType: 'FIRST_SIGN', status: { in: ['SIGNED',
//      'EFFECTIVE'] } } 且 { customer: { contracts: { none: { contractType: 'FORMAL',
//      status: { not: 'VOID' }, deletedAt: null } } } }（deletedAt null 入 none 条件——
//      VOID FORMAL 不算"有正式合同"，不豁免首签判定）。
//   4. paid-no-case：{ contractType: 'FORMAL', receivedAmount: { gt: 0 } } 且
//      { case: null }（Contract.case 1:1 关系直接过滤）。
// AnomalyContractView（本件自定义，brief 钉死字段）：{ contractId, contractNo,
//   contractType, customerId, amount, receivedAmount, status, signDate, effectiveDate,
//   gapAmount: string | null }；amount/receivedAmount/gapAmount 均 toFixed(2)
//   （formatAmount 共享 contract-projection 纪律）；gapAmount 仅 received-uninvoiced
//   口径非空。

import { Contract, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { ContractStatus, ContractType } from '../../domain/contract/contract-policy';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeNonNegativeInteger,
} from '../../domain/master-data/master-data-validation';
import { formatAmount } from '../contract/contract-projection';
import { buildContractScopeWhere } from '../contract/contract-scope';
import { AnomalyListQuery, PagedResult } from './finance-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** FIN-05 异常台账输出视图：合同标识 + 金额（toFixed(2)）+ gapAmount（仅 received-uninvoiced 口径非空）。 */
export interface AnomalyContractView {
  contractId: string;
  contractNo: string;
  contractType: ContractType;
  customerId: string;
  amount: string;
  receivedAmount: string;
  status: ContractStatus;
  signDate: Date | null;
  effectiveDate: Date | null;
  gapAmount: string | null;
}

/**
 * FIN-05 四口径异常台账（纯只读）。零事务/零事件/零审计/零 outbox；
 * 四方法均为 requireAction('anomaly.read') → 白名单键 → 分页规范 → 范围 → 查询信封。
 */
export class AnomalyService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    // actor 保留供 Task 10/11 工厂同构注入（纯读不使用——零审计纪律）。
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /**
   * 口径 1 signed-unpaid：SIGNED/EFFECTIVE 且分文未收（receivedAmount = 0）的合同。
   * gapAmount 恒 null。
   */
  async listSignedUnpaid(query: AnomalyListQuery): Promise<PagedResult<AnomalyContractView>> {
    this.authorization.requireAction(this.authorizationContext, 'anomaly.read');
    assertExactKeys(query, ['page', 'pageSize']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('anomaly.read');

    const where: Prisma.ContractWhereInput = {
      AND: [
        scopeWhere,
        { deletedAt: null },
        { status: { in: ['SIGNED', 'EFFECTIVE'] }, receivedAmount: 0 },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(contract => projectAnomalyContract(contract, null)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 口径 2 received-uninvoiced：已收（receivedAmount > 0）但 COMPLETED 发票累计
   * < receivedAmount 的合同。页级聚合：scope 过滤取当页合同 → 按页聚合 COMPLETED
   * 发票 → 内存过滤（receivedAmount > invoicedSum）→ 重组分页（页内条数可 < pageSize）。
   * gapAmount = receivedAmount − invoicedSum（toFixed(2)）。
   */
  async listReceivedUninvoiced(query: AnomalyListQuery): Promise<PagedResult<AnomalyContractView>> {
    this.authorization.requireAction(this.authorizationContext, 'anomaly.read');
    assertExactKeys(query, ['page', 'pageSize']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('anomaly.read');

    // 候选池：scope + 未删 + 已收（发票聚合在页级完成，不能进 DB where）。
    const where: Prisma.ContractWhereInput = {
      AND: [scopeWhere, { deletedAt: null }, { receivedAmount: { gt: 0 } }],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    if (rows.length === 0) {
      return { list: [], page, pageSize, total };
    }

    const pageIds = rows.map(row => row.id);
    const grouped = await this.prisma.invoiceRequest.groupBy({
      by: ['contractId'],
      where: { contractId: { in: pageIds }, status: 'COMPLETED' },
      _sum: { amount: true },
    });
    const invoicedByContract = new Map<string, Prisma.Decimal>();
    for (const group of grouped) {
      invoicedByContract.set(group.contractId, group._sum.amount ?? new Prisma.Decimal(0));
    }

    const list = rows
      .filter(contract => {
        const invoiced = invoicedByContract.get(contract.id) ?? new Prisma.Decimal(0);
        return contract.receivedAmount.greaterThan(invoiced);
      })
      .map(contract => {
        const invoiced = invoicedByContract.get(contract.id) ?? new Prisma.Decimal(0);
        const gap = contract.receivedAmount.minus(invoiced);
        return projectAnomalyContract(contract, gap);
      });
    return { list, page, pageSize, total };
  }

  /**
   * 口径 3 first-sign-no-formal：SIGNED/EFFECTIVE 的首签合同，且同客户不存在
   * 非 VOID/非软删的 FORMAL 合同（关系 none 过滤——VOID FORMAL 不算"有正式合同"）。
   */
  async listFirstSignNoFormal(query: AnomalyListQuery): Promise<PagedResult<AnomalyContractView>> {
    this.authorization.requireAction(this.authorizationContext, 'anomaly.read');
    assertExactKeys(query, ['page', 'pageSize']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('anomaly.read');

    const where: Prisma.ContractWhereInput = {
      AND: [
        scopeWhere,
        { deletedAt: null },
        { contractType: 'FIRST_SIGN', status: { in: ['SIGNED', 'EFFECTIVE'] } },
        { customer: { contracts: { none: { contractType: 'FORMAL', status: { not: 'VOID' }, deletedAt: null } } } },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(contract => projectAnomalyContract(contract, null)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 口径 4 paid-no-case：已收的 FORMAL 合同（receivedAmount > 0）且未关联案件
   * （case 1:1 关系为 null——已建案排除）。
   */
  async listPaidNoCase(query: AnomalyListQuery): Promise<PagedResult<AnomalyContractView>> {
    this.authorization.requireAction(this.authorizationContext, 'anomaly.read');
    assertExactKeys(query, ['page', 'pageSize']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('anomaly.read');

    const where: Prisma.ContractWhereInput = {
      AND: [
        scopeWhere,
        { deletedAt: null },
        { contractType: 'FORMAL', receivedAmount: { gt: 0 } },
        { case: null },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(contract => projectAnomalyContract(contract, null)),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 异常台账动作级合同范围：以 resource='anomaly' 解析范围目标（S15 双键——catalog
   * anomaly.read 的 resource 为 'anomaly'，授权上下文按 (resource, permissionCode)
   * 双键过滤，错传缺省 'contract' 则恒空集 fail-closed），锚定 Contract 自身列。
   */
  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.ContractWhereInput> {
    return buildContractScopeWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      permissionCode,
      'anomaly',
    );
  }
}

/**
 * Contract → AnomalyContractView 投影：金额 toFixed(2)（formatAmount 共享纪律）；
 * gapAmount 仅调用方传非空 Decimal（received-uninvoiced 口径），其余口径传 null。
 */
function projectAnomalyContract(
  contract: Contract,
  gapAmount: Prisma.Decimal | null,
): AnomalyContractView {
  return {
    contractId: contract.id,
    contractNo: contract.contractNo,
    contractType: contract.contractType as ContractType,
    customerId: contract.customerId,
    amount: formatAmount(contract.amount),
    receivedAmount: formatAmount(contract.receivedAmount),
    status: contract.status as ContractStatus,
    signDate: contract.signDate,
    effectiveDate: contract.effectiveDate,
    gapAmount: gapAmount === null ? null : formatAmount(gapAmount),
  };
}

function normalizePage(value: unknown): number {
  if (value === undefined) return 1;
  const page = normalizeNonNegativeInteger(value);
  if (page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
  return page;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const pageSize = normalizeNonNegativeInteger(value);
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new MasterDataError('VALIDATION_FAILED', 400);
  return pageSize;
}
