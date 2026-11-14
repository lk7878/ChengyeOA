// SPEC-011 Task 11: 成本 Zustand store（模式仿 src/stores/payment-store.ts）。
// 管理：成本列表（类别筛选 + 分页）、新建/编辑（编辑走 PATCH { amount, occurredAt,
// note, version } 乐观锁）、删除（cost.delete，二次确认在页面层）。
import { create } from 'zustand';
import { costApi } from '@/api/cost';
import type {
  CostCategory,
  CostView,
  CreateCostInput,
  ListCostsQuery,
  UpdateCostInput,
} from '@/api/cost';

export interface CostListFilters {
  category?: CostCategory;
  channelId?: string;
  caseId?: string;
}

interface CostState {
  costs: CostView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: CostListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchCosts: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: CostListFilters) => Promise<void>;
  createCost: (input: CreateCostInput) => Promise<CostView | null>;
  updateCost: (id: string, input: UpdateCostInput) => Promise<CostView | null>;
  removeCost: (id: string) => Promise<boolean>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function definedQuery(filters: CostListFilters): ListCostsQuery {
  const query: ListCostsQuery = {};
  if (filters.category !== undefined) query.category = filters.category;
  if (filters.channelId) query.channelId = filters.channelId;
  if (filters.caseId) query.caseId = filters.caseId;
  return query;
}

export const useCostStore = create<CostState>()((set, get) => ({
  costs: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchCosts: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await costApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        costs: res.data.list,
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
    await get().fetchCosts(1);
  },

  createCost: async input => {
    try {
      const res = await costApi.create(input);
      return res.data;
    } catch {
      return null;
    }
  },

  updateCost: async (id, input) => {
    try {
      const res = await costApi.update(id, input);
      set({
        costs: get().costs.map(cost => (cost.id === id ? res.data : cost)),
      });
      return res.data;
    } catch {
      return null;
    }
  },

  removeCost: async id => {
    try {
      await costApi.remove(id);
      // 删除成功后本地递减 total（防末页末行删除后分页 total 陈旧/页码越界）。
      set({
        costs: get().costs.filter(cost => cost.id !== id),
        listTotal: Math.max(0, get().listTotal - 1),
      });
      return true;
    } catch {
      return false;
    }
  },

  reset: () => set({
    costs: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
  }),
}));
