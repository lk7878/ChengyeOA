import { requestErrorMessage as errorMessage } from '@/api/errors';
// SPEC-009 Task 11: 线索域 Zustand store（模式仿 src/stores/authStore.ts）。
// 管理：列表（筛选/分页）、公海/回收池（领取）、详情（跟进时间线/邀约/状态流转/分配/回收/转客户）。
import { create } from 'zustand';
import { leadApi } from '@/api/lead';
import { appointmentApi } from '@/api/appointment';
import type {
  AppointmentView,
  AssignLeadInput,
  ConvertLeadInput,
  CreateAppointmentInput,
  CreateLeadInput,
  CreateLeadResult,
  CustomerView,
  LeadFollowView,
  LeadListQuery,
  LeadStatus,
  LeadView,
  PoolStatus,
  RecordFollowInput,
  TransitionLeadInput,
} from '@/api/types';

export interface LeadListFilters {
  status?: LeadStatus;
  poolStatus?: PoolStatus;
  channelId?: string;
  assignedTo?: string;
  keyword?: string;
}

export interface LeadDetailState {
  lead: LeadView | null;
  follows: LeadFollowView[];
  appointments: AppointmentView[];
  loading: boolean;
  error: string | null;
}

interface LeadState {
  leads: LeadView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listFilters: LeadListFilters;
  listLoading: boolean;
  listError: string | null;
  fetchLeads: (page?: number, pageSize?: number) => Promise<void>;
  applyFilters: (filters: LeadListFilters) => Promise<void>;
  createLead: (input: CreateLeadInput) => Promise<CreateLeadResult | null>;

  poolLeads: LeadView[];
  poolTotal: number;
  poolPage: number;
  poolPageSize: number;
  poolStatus: PoolStatus;
  poolKeyword: string;
  poolLoading: boolean;
  poolError: string | null;
  fetchPool: (page?: number, pageSize?: number) => Promise<void>;
  applyPoolStatus: (status: PoolStatus) => Promise<void>;
  applyPoolKeyword: (keyword: string) => Promise<void>;
  claimLead: (leadId: string) => Promise<boolean>;

  detail: LeadDetailState;
  fetchLeadDetail: (id: string) => Promise<void>;
  addFollow: (id: string, input: RecordFollowInput) => Promise<boolean>;
  transitionLead: (id: string, input: TransitionLeadInput) => Promise<boolean>;
  assignLead: (id: string, input: AssignLeadInput) => Promise<boolean>;
  recycleLead: (id: string, reason?: string) => Promise<boolean>;
  convertLead: (id: string, input: ConvertLeadInput) => Promise<CustomerView | null>;
  createAppointment: (input: CreateAppointmentInput) => Promise<boolean>;
  visitAppointment: (id: string) => Promise<boolean>;
  rescheduleAppointment: (id: string, scheduledAt: string) => Promise<boolean>;
  resetDetail: () => void;
  reset: () => void;
}

const initialDetail: LeadDetailState = {
  lead: null,
  follows: [],
  appointments: [],
  loading: false,
  error: null,
};


function definedQuery(filters: LeadListFilters): LeadListQuery {
  const query: LeadListQuery = {};
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.poolStatus !== undefined) query.poolStatus = filters.poolStatus;
  if (filters.channelId) query.channelId = filters.channelId;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;
  if (filters.keyword) query.keyword = filters.keyword;
  return query;
}

export const useLeadStore = create<LeadState>()((set, get) => ({
  leads: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listFilters: {},
  listLoading: false,
  listError: null,

  fetchLeads: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const res = await leadApi.list({ page: nextPage, pageSize: nextPageSize, ...definedQuery(get().listFilters) });
      set({
        leads: res.data.list,
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
    await get().fetchLeads(1);
  },

  createLead: async input => {
    try {
      const res = await leadApi.create(input);
      return res.data;
    } catch {
      return null; // 全局拦截器已提示错误。
    }
  },

  poolLeads: [],
  poolTotal: 0,
  poolPage: 1,
  poolPageSize: 10,
  poolStatus: 'PUBLIC',
  poolKeyword: '',
  poolLoading: false,
  poolError: null,

  fetchPool: async (page, pageSize) => {
    const nextPage = page ?? get().poolPage;
    const nextPageSize = pageSize ?? get().poolPageSize;
    set({ poolLoading: true, poolError: null });
    try {
      const keyword = get().poolKeyword;
      const res = await leadApi.pool({
        page: nextPage,
        pageSize: nextPageSize,
        poolStatus: get().poolStatus,
        ...(keyword ? { keyword } : {}),
      });
      set({
        poolLeads: res.data.list,
        poolTotal: res.data.total,
        poolPage: res.data.page,
        poolPageSize: res.data.pageSize,
        poolLoading: false,
      });
    } catch (error) {
      set({ poolLoading: false, poolError: errorMessage(error) });
    }
  },

  applyPoolStatus: async status => {
    set({ poolStatus: status });
    await get().fetchPool(1);
  },

  applyPoolKeyword: async keyword => {
    set({ poolKeyword: keyword });
    await get().fetchPool(1);
  },

  claimLead: async leadId => {
    set({ poolLoading: true, poolError: null });
    try {
      await leadApi.claim(leadId);
      await get().fetchPool(get().poolPage);
      return true;
    } catch (error) {
      set({ poolLoading: false, poolError: errorMessage(error) });
      return false;
    }
  },

  detail: initialDetail,

  fetchLeadDetail: async id => {
    set({ detail: { ...get().detail, loading: true, error: null } });
    try {
      const res = await leadApi.detail(id);
      set({ detail: { ...get().detail, lead: res.data, loading: false } });
    } catch (error) {
      set({ detail: { ...get().detail, loading: false, error: errorMessage(error) } });
      return;
    }
    // 跟进时间线与邀约列表独立加载：无 appointment.read 权限的用户仍可查看线索主体。
    try {
      const follows = await leadApi.follows(id);
      set({ detail: { ...get().detail, follows: follows.data } });
    } catch { /* 拦截器已提示；时间线保持空态。 */ }
    try {
      const appointments = await leadApi.appointments(id);
      set({ detail: { ...get().detail, appointments: appointments.data } });
    } catch { /* 拦截器已提示；邀约保持空态。 */ }
  },

  addFollow: async (id, input) => {
    try {
      await leadApi.addFollow(id, input);
      const follows = await leadApi.follows(id);
      const lead = await leadApi.detail(id);
      set({ detail: { ...get().detail, follows: follows.data, lead: lead.data } });
      return true;
    } catch {
      return false;
    }
  },

  transitionLead: async (id, input) => {
    try {
      const res = await leadApi.transition(id, input);
      set({ detail: { ...get().detail, lead: res.data } });
      return true;
    } catch {
      return false;
    }
  },

  assignLead: async (id, input) => {
    try {
      const res = await leadApi.assign(id, input);
      set({ detail: { ...get().detail, lead: res.data } });
      return true;
    } catch {
      return false;
    }
  },

  recycleLead: async (id, reason) => {
    try {
      const res = await leadApi.recycle(id, reason ? { reason } : {});
      set({ detail: { ...get().detail, lead: res.data } });
      return true;
    } catch {
      return false;
    }
  },

  convertLead: async (id, input) => {
    try {
      const res = await leadApi.convert(id, input);
      return res.data;
    } catch {
      return null;
    }
  },

  createAppointment: async input => {
    try {
      await appointmentApi.create(input);
      const appointments = await leadApi.appointments(input.leadId);
      const lead = await leadApi.detail(input.leadId);
      set({ detail: { ...get().detail, appointments: appointments.data, lead: lead.data } });
      return true;
    } catch {
      return false;
    }
  },

  visitAppointment: async id => {
    try {
      await appointmentApi.visit(id);
      const leadId = get().detail.lead?.id;
      if (leadId) {
        const appointments = await leadApi.appointments(leadId);
        const lead = await leadApi.detail(leadId);
        set({ detail: { ...get().detail, appointments: appointments.data, lead: lead.data } });
      }
      return true;
    } catch {
      return false;
    }
  },

  rescheduleAppointment: async (id, scheduledAt) => {
    try {
      await appointmentApi.reschedule(id, scheduledAt);
      const leadId = get().detail.lead?.id;
      if (leadId) {
        const appointments = await leadApi.appointments(leadId);
        set({ detail: { ...get().detail, appointments: appointments.data } });
      }
      return true;
    } catch {
      return false;
    }
  },

  resetDetail: () => set({ detail: initialDetail }),

  reset: () => set({
    leads: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listFilters: {},
    listLoading: false,
    listError: null,
    poolLeads: [],
    poolTotal: 0,
    poolPage: 1,
    poolPageSize: 10,
    poolStatus: 'PUBLIC',
    poolKeyword: '',
    poolLoading: false,
    poolError: null,
    detail: initialDetail,
  }),
}));
