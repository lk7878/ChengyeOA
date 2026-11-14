import { requestErrorMessage as errorMessage } from '@/api/errors';
// SPEC-009 Task 11: 客户域 Zustand store（模式仿 src/stores/authStore.ts）。
// 管理：客户列表（筛选/分页）、详情（档案编辑 + 联系人查/增/改/删）。
// 联系人列表经 C1 增量端点 GET /customers/:id/contacts 随详情并行加载；
// 写操作仍以返回的 ContactView 就地更新本地数组（省一次回源）。
import { create } from 'zustand';
import { customerApi } from '@/api/customer';
import type {
  ContactInput,
  ContactView,
  CreateCustomerInput,
  CustomerListQuery,
  CustomerStatus,
  CustomerType,
  CustomerView,
  UpdateCustomerInput,
} from '@/api/types';

export interface CustomerListFilters {
  status?: CustomerStatus;
  customerType?: CustomerType;
  keyword?: string;
}

export interface CustomerDetailState {
  customer: CustomerView | null;
  contacts: ContactView[];
  loading: boolean;
  error: string | null;
}

interface CustomerState {
  customers: CustomerView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: CustomerListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchCustomers: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: CustomerListFilters) => Promise<void>;
  createCustomer: (input: CreateCustomerInput) => Promise<CustomerView | null>;

  detail: CustomerDetailState;
  fetchCustomerDetail: (id: string) => Promise<void>;
  updateCustomer: (id: string, input: UpdateCustomerInput) => Promise<boolean>;
  addContact: (customerId: string, input: ContactInput) => Promise<boolean>;
  updateContact: (customerId: string, contactId: string, input: ContactInput) => Promise<boolean>;
  removeContact: (customerId: string, contactId: string) => Promise<boolean>;
  resetDetail: () => void;
  reset: () => void;
}

const initialDetail: CustomerDetailState = {
  customer: null,
  contacts: [],
  loading: false,
  error: null,
};


function definedQuery(filters: CustomerListFilters): CustomerListQuery {
  const query: CustomerListQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.customerType !== undefined) query.customerType = filters.customerType;
  if (filters.keyword) query.keyword = filters.keyword;
  return query;
}

export const useCustomerStore = create<CustomerState>()((set, get) => ({
  customers: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchCustomers: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await customerApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        customers: res.data.list,
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
    await get().fetchCustomers(1);
  },

  createCustomer: async input => {
    try {
      const res = await customerApi.create(input);
      return res.data;
    } catch {
      return null;
    }
  },

  detail: initialDetail,

  fetchCustomerDetail: async id => {
    set({ detail: { ...(get().detail.customer?.id === id ? get().detail : initialDetail), loading: true, error: null } });
    try {
      const [customerRes, contactsRes] = await Promise.all([
        customerApi.detail(id),
        customerApi.listContacts(id),
      ]);
      set({
        detail: {
          ...get().detail,
          customer: customerRes.data,
          contacts: contactsRes.data,
          loading: false,
        },
      });
    } catch (error) {
      set({ detail: { ...get().detail, loading: false, error: errorMessage(error) } });
    }
  },

  updateCustomer: async (id, input) => {
    try {
      const res = await customerApi.update(id, input);
      set({ detail: { ...get().detail, customer: res.data } });
      return true;
    } catch {
      return false;
    }
  },

  addContact: async (customerId, input) => {
    try {
      const res = await customerApi.addContact(customerId, input);
      set({ detail: { ...get().detail, contacts: [...get().detail.contacts, res.data] } });
      return true;
    } catch {
      return false;
    }
  },

  updateContact: async (customerId, contactId, input) => {
    try {
      const res = await customerApi.updateContact(customerId, contactId, input);
      set({
        detail: {
          ...get().detail,
          contacts: get().detail.contacts.map(contact => (contact.id === contactId ? res.data : contact)),
        },
      });
      return true;
    } catch {
      return false;
    }
  },

  removeContact: async (customerId, contactId) => {
    try {
      await customerApi.removeContact(customerId, contactId);
      set({
        detail: {
          ...get().detail,
          contacts: get().detail.contacts.filter(contact => contact.id !== contactId),
        },
      });
      return true;
    } catch {
      return false;
    }
  },

  resetDetail: () => set({ detail: initialDetail }),

  reset: () => set({
    customers: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
    detail: initialDetail,
  }),
}));
