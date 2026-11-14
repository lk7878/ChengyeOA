// SPEC-011 Task 11: 开票申请 Zustand store（模式仿 src/stores/payment-store.ts）。
// 管理：开票列表（状态筛选 + 分页）、申请（PENDING）、审批/驳回（PENDING→目标态）、
// 完成（APPROVED→COMPLETED，以返回视图就地更新列表行，省一次回源）。
import { create } from 'zustand';
import { invoiceApi } from '@/api/invoice';
import type {
  CompleteInvoiceInput,
  CreateInvoiceInput,
  InvoiceActionInput,
  InvoiceStatus,
  InvoiceView,
  ListInvoicesQuery,
} from '@/api/invoice';

export interface InvoiceListFilters {
  caseNo?: string;
  status?: InvoiceStatus;
  contractId?: string;
  customerId?: string;
}

interface InvoiceState {
  invoices: InvoiceView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: InvoiceListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchInvoices: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: InvoiceListFilters) => Promise<void>;
  createInvoice: (input: CreateInvoiceInput) => Promise<InvoiceView | null>;
  approveInvoice: (id: string, input?: InvoiceActionInput) => Promise<boolean>;
  rejectInvoice: (id: string, input: InvoiceActionInput) => Promise<boolean>;
  completeInvoice: (id: string, input: CompleteInvoiceInput) => Promise<boolean>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function definedQuery(filters: InvoiceListFilters): ListInvoicesQuery {
  const query: ListInvoicesQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.contractId) query.contractId = filters.contractId;
  if (filters.caseNo) query.caseNo = filters.caseNo;
  if (filters.customerId) query.customerId = filters.customerId;
  return query;
}

function updateRow(
  invoices: InvoiceView[],
  id: string,
  view: InvoiceView,
): InvoiceView[] {
  return invoices.map(invoice => (invoice.id === id ? { ...invoice, ...view } : invoice));
}

export const useInvoiceStore = create<InvoiceState>()((set, get) => ({
  invoices: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchInvoices: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await invoiceApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        invoices: res.data.list,
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
    await get().fetchInvoices(1);
  },

  createInvoice: async input => {
    try {
      const res = await invoiceApi.create(input);
      return res.data;
    } catch {
      return null;
    }
  },

  approveInvoice: async (id, input = {}) => {
    try {
      const res = await invoiceApi.approve(id, input);
      set({ invoices: updateRow(get().invoices, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  rejectInvoice: async (id, input) => {
    try {
      const res = await invoiceApi.reject(id, input);
      set({ invoices: updateRow(get().invoices, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  completeInvoice: async (id, input) => {
    try {
      const res = await invoiceApi.complete(id, input);
      set({ invoices: updateRow(get().invoices, id, res.data) });
      return true;
    } catch {
      return false;
    }
  },

  reset: () => set({
    invoices: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
  }),
}));
