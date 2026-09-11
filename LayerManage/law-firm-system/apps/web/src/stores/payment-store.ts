// SPEC-010 Task 11: 收款域 Zustand store（模式仿 src/stores/customer-store.ts）。
// 管理：收款列表（状态筛选 + 分页）、登记（PENDING）、确认（PENDING→CONFIRMED，
// 以返回视图就地更新列表行，省一次回源）。
import { create } from 'zustand';
import { paymentApi } from '@/api/payment';
import type {
  ConfirmPaymentInput,
  CreatePaymentInput,
  ListPaymentsQuery,
  PaymentStatus,
  PaymentView,
  VoidPaymentInput,
} from '@/api/payment';

export interface PaymentListFilters {
  caseNo?: string;
  status?: PaymentStatus;
  contractId?: string;
  customerId?: string;
}

interface PaymentState {
  payments: PaymentView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: PaymentListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchPayments: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: PaymentListFilters) => Promise<void>;
  createPayment: (input: CreatePaymentInput) => Promise<PaymentView | null>;
  confirmPayment: (id: string, input?: ConfirmPaymentInput) => Promise<boolean>;
  voidPayment: (id: string, input: VoidPaymentInput) => Promise<boolean>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function definedQuery(filters: PaymentListFilters): ListPaymentsQuery {
  const query: ListPaymentsQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.contractId) query.contractId = filters.contractId;
  if (filters.caseNo) query.caseNo = filters.caseNo;
  if (filters.customerId) query.customerId = filters.customerId;
  return query;
}

export const usePaymentStore = create<PaymentState>()((set, get) => ({
  payments: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchPayments: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await paymentApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        payments: res.data.list,
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
    await get().fetchPayments(1);
  },

  createPayment: async input => {
    try {
      const res = await paymentApi.create(input);
      return res.data;
    } catch {
      return null;
    }
  },

  confirmPayment: async (id, input = {}) => {
    try {
      const res = await paymentApi.confirm(id, input);
      set({
        payments: get().payments.map(payment => (payment.id === id ? { ...payment, ...res.data } : payment)),
      });
      return true;
    } catch {
      return false;
    }
  },

  voidPayment: async (id, input) => {
    try {
      const res = await paymentApi.void(id, input);
      set({
        payments: get().payments.map(payment => (payment.id === id ? { ...payment, ...res.data } : payment)),
      });
      return true;
    } catch {
      return false;
    }
  },

  reset: () => set({
    payments: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
  }),
}));
