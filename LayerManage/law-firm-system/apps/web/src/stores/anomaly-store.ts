// SPEC-011 Task 11: 财务异常台账 Zustand store（模式仿 src/stores/payment-store.ts）。
// 管理：四口径 Tab（signed-unpaid / received-uninvoiced / first-sign-no-formal /
// paid-no-case）各持一列表；切换 Tab 即切换 mode 并回第 1 页。纯只读，零动作方法。
// received-uninvoiced 口径 total = 候选池 count（Task 9/10 已文档化）——分页条按此语义。
import { create } from 'zustand';
import { anomalyApi } from '@/api/anomaly';
import type { PagedResult } from '@/api/types';
import type { AnomalyContractView, ListAnomaliesQuery } from '@/api/anomaly';

export type AnomalyMode = 'signedUnpaid' | 'receivedUninvoiced' | 'firstSignNoFormal' | 'paidNoCase';

const ANOMALY_MODES: AnomalyMode[] = ['signedUnpaid', 'receivedUninvoiced', 'firstSignNoFormal', 'paidNoCase'];

interface AnomalyState {
  mode: AnomalyMode;
  anomalies: AnomalyContractView[];
  listTotal: number;
  listPage: number;
  listPageSize: number;
  listLoading: boolean;
  listError: string | null;
  setMode: (mode: AnomalyMode) => Promise<void>;
  fetchAnomalies: (page?: number, pageSize?: number) => Promise<void>;
  reset: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败';
}

function loadAnomalies(
  mode: AnomalyMode,
  query: ListAnomaliesQuery,
): Promise<PagedResult<AnomalyContractView>> {
  switch (mode) {
    case 'signedUnpaid':
      return anomalyApi.listSignedUnpaid(query).then(res => res.data);
    case 'receivedUninvoiced':
      return anomalyApi.listReceivedUninvoiced(query).then(res => res.data);
    case 'firstSignNoFormal':
      return anomalyApi.listFirstSignNoFormal(query).then(res => res.data);
    case 'paidNoCase':
      return anomalyApi.listPaidNoCase(query).then(res => res.data);
  }
}

export const useAnomalyStore = create<AnomalyState>()((set, get) => ({
  mode: 'signedUnpaid',
  anomalies: [],
  listTotal: 0,
  listPage: 1,
  listPageSize: 10,
  listLoading: false,
  listError: null,

  setMode: async mode => {
    if (!ANOMALY_MODES.includes(mode)) return;
    set({ mode, listPage: 1 });
    await get().fetchAnomalies(1);
  },

  fetchAnomalies: async (page, pageSize) => {
    const nextPage = page ?? get().listPage;
    const nextPageSize = pageSize ?? get().listPageSize;
    set({ listLoading: true, listError: null });
    try {
      const data = await loadAnomalies(get().mode, { page: nextPage, pageSize: nextPageSize });
      set({
        anomalies: data.list,
        listTotal: data.total,
        listPage: data.page,
        listPageSize: data.pageSize,
        listLoading: false,
      });
    } catch (error) {
      set({ listLoading: false, listError: errorMessage(error) });
    }
  },

  reset: () => set({
    mode: 'signedUnpaid',
    anomalies: [],
    listTotal: 0,
    listPage: 1,
    listPageSize: 10,
    listLoading: false,
    listError: null,
  }),
}));
