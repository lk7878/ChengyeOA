// SPEC-013 Task 8: 审批中心 Zustand store（模式仿 src/stores/refund-store.ts）。
// 管理：三 Tab（APPLIED 我的申请 / TODO 我的待办 / DONE 我的已办）共享一个列表状态 +
// activeRole（切 Tab 即换 role 回源）；definitions（approval.apply 门控，发起表单渲染）；
// apply/process/withdraw 动作（process 以 taskId 为 URL 位，withdraw 以 instanceId 为 URL 位）。
// 错误解析读 response.data.message（包络 code=HTTP 数字态、message=业务码字符串）。
import { create } from 'zustand';
import { message } from 'antd';
import { approvalApi } from '@/api/approval';
import type {
  ApplyApprovalInput,
  ApprovalBusinessType,
  ApprovalDefinitionView,
  ApprovalInstanceStatus,
  ApprovalInstanceView,
  ApprovalRoleFilter,
  ProcessTaskInput,
  WithdrawInput,
} from '@/api/approval';

/** SPEC-028 全组织视图筛选/搜索（仅 role='ALL' 生效，其余 role 传 → 后端 400）。 */
export interface ApprovalListFilters {
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
}

interface ApprovalState {
  instances: ApprovalInstanceView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  activeRole: ApprovalRoleFilter;
  listLoading: boolean;
  listError: string | null;
  definitions: ApprovalDefinitionView[];
  definitionsLoading: boolean;
  fetchInstances: (role?: ApprovalRoleFilter, page?: number, pageSize?: number, filters?: ApprovalListFilters) => Promise<void>;
  fetchDefinitions: () => Promise<void>;
  applyApproval: (input: ApplyApprovalInput) => Promise<boolean>;
  processApproval: (taskId: string, input: ProcessTaskInput) => Promise<boolean>;
  withdrawApproval: (id: string, input: WithdrawInput) => Promise<boolean>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string } } } | undefined)?.response;
  if (response?.data?.message) return response.data.message;
  return error instanceof Error && error.message ? error.message : '请求失败';
}

// SPEC-014 Task 3：动作失败内联提示——读 response.data.message（业务码），无则兜底「操作失败」。
function actionErrorMessage(error: unknown): string {
  return (error as { response?: { data?: { message?: string } } } | undefined)?.response?.data?.message ?? '操作失败';
}

export const useApprovalStore = create<ApprovalState>()((set, get) => ({
  instances: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  activeRole: 'APPLIED',
  listLoading: false,
  listError: null,
  definitions: [],
  definitionsLoading: false,

  fetchInstances: async (role, page, pageSize, filters) => {
    const nextRole = role ?? get().activeRole;
    const nextPage = page ?? 1;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null, activeRole: nextRole });
    try {
      const res = await approvalApi.list({
        role: nextRole,
        page: nextPage,
        pageSize: nextPageSize,
        ...(nextRole === 'ALL' && filters ? { ...filters } : {}),
      });
      set({
        instances: res.data.list,
        listTotal: res.data.total,
        listPage: res.data.page,
        listPageSize: res.data.pageSize,
        listLoading: false,
      });
    } catch (error) {
      set({ listLoading: false, listError: errorMessage(error) });
    }
  },

  fetchDefinitions: async () => {
    set({ definitionsLoading: true });
    try {
      const res = await approvalApi.definitions();
      set({ definitions: res.data, definitionsLoading: false });
    } catch {
      // 403（无 approval.apply）或网络失败：保持空目录，发起按钮已按权限门控。
      set({ definitionsLoading: false });
    }
  },

  applyApproval: async input => {
    try {
      await approvalApi.apply(input);
      return true;
    } catch (error) {
      // SPEC-014 Task 3：动作失败用户可见（沿 request 拦截器 message.error 惯例补内联反馈）。
      message.error(actionErrorMessage(error));
      return false;
    }
  },

  processApproval: async (taskId, input) => {
    try {
      await approvalApi.process(taskId, input);
      return true;
    } catch (error) {
      // SPEC-014 Task 3：动作失败用户可见（沿 request 拦截器 message.error 惯例补内联反馈）。
      message.error(actionErrorMessage(error));
      return false;
    }
  },

  withdrawApproval: async (id, input) => {
    try {
      await approvalApi.withdraw(id, input);
      return true;
    } catch (error) {
      // SPEC-014 Task 3：动作失败用户可见（沿 request 拦截器 message.error 惯例补内联反馈）。
      message.error(actionErrorMessage(error));
      return false;
    }
  },

  reset: () => set({
    instances: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    activeRole: 'APPLIED',
    listLoading: false,
    listError: null,
    definitions: [],
    definitionsLoading: false,
  }),
}));
