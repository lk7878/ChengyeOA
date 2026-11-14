// SPEC-011 Task 11: 退款/减免 Zustand store（模式仿 src/stores/payment-store.ts）。
// 管理：退款/减免列表（type/status 筛选 + 分页）、申请（PENDING）、审批/驳回（PENDING→
// 目标态，refund.approve 为 SPECIAL/CRITICAL 码——按钮语义由页面按敏感操作形态处理）、
// 执行（APPROVED→EXECUTED，以返回视图就地更新列表行，省一次回源）。
import { create } from 'zustand';
import { refundApi } from '@/api/refund';
import type {
  CreateRefundInput,
  ListRefundsQuery,
  RefundActionInput,
  RefundStatus,
  RefundType,
  RefundView,
} from '@/api/refund';

export interface RefundListFilters {
  caseNo?: string;
  status?: RefundStatus;
  type?: RefundType;
  contractId?: string;
  customerId?: string;
}

interface RefundState {
  refunds: RefundView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: RefundListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchRefunds: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: RefundListFilters) => Promise<void>;
  createRefund: (input: CreateRefundInput) => Promise<RefundView | null>;
  approveRefund: (id: string, input?: RefundActionInput, stepUpToken?: string) => Promise<boolean>;
  rejectRefund: (id: string, input: RefundActionInput) => Promise<boolean>;
  executeRefund: (id: string, input?: RefundActionInput) => Promise<boolean>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function definedQuery(filters: RefundListFilters): ListRefundsQuery {
  const query: ListRefundsQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.type !== undefined) query.type = filters.type;
  if (filters.contractId) query.contractId = filters.contractId;
  if (filters.caseNo) query.caseNo = filters.caseNo;
  if (filters.customerId) query.customerId = filters.customerId;
  return query;
}

function updateRow(refunds: RefundView[], id: string, view: RefundView): RefundView[] {
  return refunds.map(refund => (refund.id === id ? { ...refund, ...view } : refund));
}

export const useRefundStore = create<RefundState>()((set, get) => ({
  refunds: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchRefunds: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await refundApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        refunds: res.data.list,
        listTotal: res.data.total,
        listPage: res.data.page,
        listPageSize: res.data.pageSize,
        listLoading: false,
      });
    } catch (error) {
      set({ listLoading: false, listError: errorMessage(error) });
    }
  },

  applyFilters: async filters => {
    set({ listFilters: filters });
    await get().fetchRefunds(1);
  },

  createRefund: async input => {
    try {
      const res = await refundApi.create(input);
      return res.data;
    } catch {
      return null;
    }
  },

  approveRefund: async (id, input = {}, stepUpToken) => {
    try {
      const res = await refundApi.approve(id, input, stepUpToken);
      set({ refunds: updateRow(get().refunds, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  rejectRefund: async (id, input) => {
    try {
      const res = await refundApi.reject(id, input);
      set({ refunds: updateRow(get().refunds, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  executeRefund: async (id, input = {}) => {
    try {
      const res = await refundApi.execute(id, input);
      set({ refunds: updateRow(get().refunds, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  reset: () => set({
    refunds: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
  }),
}));
