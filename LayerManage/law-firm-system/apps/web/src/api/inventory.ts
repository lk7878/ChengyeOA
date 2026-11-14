import request from './request';
import type { ApiResponse } from '@/types';
export type ItemKind = 'OFFICE' | 'CUSTOMIZED';
export interface InventoryRow {
  itemId?: string;
  createdBy?: string;
  createdByName?: string;
  id: string;
  code?: string;
  documentNo?: string;
  name?: string;
  itemName?: string;
  kind?: ItemKind;
  itemKind?: ItemKind;
  category?: string;
  specification?: string;
  itemSpecification?: string;
  location?: string;
  unit: string;
  stock?: string;
  minimumStock?: string;
  status?: string;
  version?: number;
  action?: string;
  quantity?: string;
  beforeStock?: string;
  afterStock?: string;
  employeeName?: string;
  organizationPath?: string;
  source?: string;
  reason?: string;
  occurredAt?: string;
  bookStock?: string;
  actualStock?: string;
  difference?: string;
  count?: number;
}
export interface InventoryItem extends InventoryRow {
  name: string;
  kind: ItemKind;
  version: number;
  stock: string;
  minimumStock: string;
  status: string;
  category: string;
}
export interface InventoryPage {
  list: InventoryRow[];
  total: number;
}
export interface InventoryDashboard {
  itemCount: number;
  lowStockCount: number;
  inboundCount: number;
  outboundCount: number;
  top: InventoryRow[];
}
export interface InventoryRecipient {
  id: string;
  name: string;
  employeeNo: string;
  organizationPath: string;
}
export type InventoryQuery = Record<string, string | number | undefined>;
export const inventoryApi = {
  detail: (source: 'items' | 'movements' | 'stocktakes', id: string) =>
    request.get<ApiResponse<InventoryRow>>('/v1/inventory/' + source + '/' + id),
  recipientPage: (page: number, keyword: string) =>
    request.get<ApiResponse<{ list: InventoryRecipient[]; total: number }>>('/v1/inventory/recipients', {
      params: { page, keyword },
    }),
  list: (params: InventoryQuery) => request.get<ApiResponse<InventoryPage>>('/v1/inventory', { params }),
  dashboard: (params: InventoryQuery) =>
    request.get<ApiResponse<InventoryDashboard>>('/v1/inventory', {
      params: { ...params, view: 'dashboard' },
    }),
  saveItem: (data: Record<string, unknown>, id?: string) =>
    id
      ? request.put<ApiResponse<InventoryItem>>('/v1/inventory/items/' + id, data)
      : request.post<ApiResponse<InventoryItem>>('/v1/inventory/items', data),
  move: (data: Record<string, unknown>) =>
    request.post<ApiResponse<InventoryRow>>('/v1/inventory/movements', data),
  stocktake: (data: Record<string, unknown>) =>
    request.post<ApiResponse<InventoryRow>>('/v1/inventory/stocktakes', data),
  recipients: (keyword?: string) =>
    request.get<ApiResponse<InventoryRecipient[]>>('/v1/inventory/recipients', { params: { keyword } }),
  export: (params: InventoryQuery) =>
    request.get<ApiResponse<{ fileName: string; csv: string }>>('/v1/inventory/export', { params }),
};
