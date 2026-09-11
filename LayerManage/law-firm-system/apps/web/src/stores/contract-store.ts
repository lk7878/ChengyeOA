// SPEC-010 Task 11: 合同域 Zustand store（模式仿 src/stores/customer-store.ts）。
// 管理：合同列表（类型/状态/关键字筛选 + 分页）、详情（合同 + 应收计划 + 收款记录）、
// 状态机动作（submit/approve/reject/sign/effect/terminate/void，写操作以返回视图就地更新）。
// plans/payments 依赖 payment.read 权限：加载失败降级为空数组，不阻塞合同详情（自裁决，
// 仅有 contract.read 的用户仍可见详情，计划/收款区块呈现空态）。
import { create } from 'zustand';
import { contractApi } from '@/api/contract';
import type {
  ApproveContractInput,
  ContractListQuery,
  ContractStatus,
  ContractType,
  ContractView,
  CreateContractInput,
  EffectContractInput,
  RejectContractInput,
  SignContractInput,
  TerminateContractInput,
  VoidContractInput,
} from '@/api/contract';
import { paymentApi } from '@/api/payment';
import type { PaymentPlanView, PaymentView } from '@/api/payment';

export interface ContractListFilters {
  status?: ContractStatus;
  contractType?: ContractType;
  customerId?: string;
  keyword?: string;
}

export interface ContractDetailState {
  contract: ContractView | null;
  plans: PaymentPlanView[];
  payments: PaymentView[];
  loading: boolean;
  error: string | null;
}

interface ContractState {
  contracts: ContractView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: ContractListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchContracts: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: ContractListFilters) => Promise<void>;
  createContract: (input: CreateContractInput) => Promise<ContractView | null>;

  detail: ContractDetailState;
  fetchContractDetail: (id: string) => Promise<void>;
  submitContract: (id: string) => Promise<boolean>;
  approveContract: (id: string, input?: ApproveContractInput) => Promise<boolean>;
  rejectContract: (id: string, input: RejectContractInput) => Promise<boolean>;
  signContract: (id: string, input?: SignContractInput) => Promise<boolean>;
  effectContract: (id: string, input?: EffectContractInput) => Promise<boolean>;
  terminateContract: (id: string, input: TerminateContractInput) => Promise<boolean>;
  voidContract: (id: string, input: VoidContractInput) => Promise<boolean>;
  resetDetail: () => void;
  reset: () => void;
}

const initialDetail: ContractDetailState = {
  contract: null,
  plans: [],
  payments: [],
  loading: false,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function definedQuery(filters: ContractListFilters): ContractListQuery {
  const query: ContractListQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.contractType !== undefined) query.contractType = filters.contractType;
  if (filters.customerId) query.customerId = filters.customerId;
  if (filters.keyword) query.keyword = filters.keyword;
  return query;
}

export const useContractStore = create<ContractState>()((set, get) => {
  /** 动作统一形态：调 API → 就地更新详情视图 → 返回成功与否（拦截器已全局提示错误）。 */
  const runAction = async (
    id: string,
    action: () => Promise<{ data: ContractView }>,
    refreshPlans = false,
  ): Promise<boolean> => {
    try {
      const res = await action();
      set({ detail: { ...get().detail, contract: res.data } });
      // 生效会生成应收计划：回源计划/收款两块（best-effort）。
      if (refreshPlans) await get().fetchContractDetail(id);
      return true;
    } catch {
      return false;
    }
  };

  return {
    contracts: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,

    fetchContracts: async (page, pageSize) => {
      const nextPage = page ?? get().listPage;
      const nextPageSize = pageSize ?? get().listPageSize;
      set({ listLoading: true, listError: null });
      try {
        const res = await contractApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
        set({
          contracts: res.data.list,
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
      await get().fetchContracts(1);
    },

    createContract: async input => {
      try {
        const res = await contractApi.create(input);
        return res.data;
      } catch {
        return null;
      }
    },

    detail: initialDetail,

    fetchContractDetail: async id => {
      set({ detail: { ...get().detail, loading: true, error: null } });
      try {
        const contractRes = await contractApi.detail(id);
        // plans/payments 走 payment.read：无该权限时 403，降级空态不阻塞详情。
        const [plansRes, paymentsRes] = await Promise.all([
          contractApi.plans(id).catch(() => null),
          paymentApi.list({ contractId: id, page: 1, pageSize: 100 }).catch(() => null),
        ]);
        set({
          detail: {
            ...get().detail,
            contract: contractRes.data,
            plans: plansRes?.data ?? [],
            payments: paymentsRes?.data.list ?? [],
            loading: false,
          },
        });
      } catch (error) {
        set({ detail: { ...get().detail, loading: false, error: errorMessage(error) } });
      }
    },

    submitContract: async id => runAction(id, () => contractApi.submit(id)),
    approveContract: async (id, input = {}) => runAction(id, () => contractApi.approve(id, input)),
    rejectContract: async (id, input) => runAction(id, () => contractApi.reject(id, input)),
    signContract: async (id, input = {}) => runAction(id, () => contractApi.sign(id, input)),
    effectContract: async (id, input = {}) => runAction(id, () => contractApi.effect(id, input), true),
    terminateContract: async (id, input) => runAction(id, () => contractApi.terminate(id, input)),
    voidContract: async (id, input) => runAction(id, () => contractApi.void(id, input)),

    resetDetail: () => set({ detail: initialDetail }),

    reset: () => set({
      contracts: [],
      listTotal: 0,
      listPage: 1,
      listPageSize: 10,
      listFilters: {},
      listLoading: false,
      listError: null,
      detail: initialDetail,
    }),
  };
});
