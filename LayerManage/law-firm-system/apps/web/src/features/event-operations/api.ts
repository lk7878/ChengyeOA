import request from '@/api/request';
import type { ApiResponse } from '@/types';
import type {
  EventDeliveryDetail,
  EventDeliveryListQuery,
  EventDeliveryPage,
  EventDeliveryRetryResult,
  EventOperationsSummary,
  EventSubscriptionSummary,
} from './types';

export const eventOperationsApi = {
  summary: (signal?: AbortSignal) => signal
    ? request.get<ApiResponse<EventOperationsSummary>>('/v1/event-operations/summary', { signal })
    : request.get<ApiResponse<EventOperationsSummary>>('/v1/event-operations/summary'),
  list: (params?: EventDeliveryListQuery, signal?: AbortSignal) => request.get<ApiResponse<EventDeliveryPage>>(
    '/v1/event-operations/deliveries', { params, ...(signal ? { signal } : {}) },
  ),
  detail: (id: string, signal?: AbortSignal) => signal
    ? request.get<ApiResponse<EventDeliveryDetail>>(`/v1/event-operations/deliveries/${id}`, { signal })
    : request.get<ApiResponse<EventDeliveryDetail>>(`/v1/event-operations/deliveries/${id}`),
  subscriptions: (signal?: AbortSignal) => signal
    ? request.get<ApiResponse<EventSubscriptionSummary[]>>('/v1/event-operations/subscriptions', { signal })
    : request.get<ApiResponse<EventSubscriptionSummary[]>>('/v1/event-operations/subscriptions'),
  retry: (id: string, expectedVersion: number) => (
    request.post<ApiResponse<EventDeliveryRetryResult>>(
      `/v1/event-operations/deliveries/${id}/retry`,
      { expectedVersion },
      { suppressGlobalError: true },
    )
  ),
};
