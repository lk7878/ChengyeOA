import request from './request';
import type { ApiResponse } from '@/types';
import type { ApprovalDefinitionView, ApprovalInstanceView, ApprovalTaskView } from './approval';

export interface ApprovalAttachment {
  id: string; fileName: string; mimeType: string; fileSize: number; sourceId: string | null; instanceId: string | null; createdAt: string;
}
export interface ApprovalMaterial {
  instance: ApprovalInstanceView; tasks: ApprovalTaskView[]; attachments: ApprovalAttachment[]; people: Array<{ id: string; name: string }>;
}
export const approvalMaterialsApi = {
  createType: (data: { name: string; templateCode: string }) => request.post<ApiResponse<ApprovalDefinitionView>>('/v1/approvals/personal-definitions', data),
  upload: (file: File, sourceId?: string, onProgress?: (value: number) => void) => {
    const body = new FormData(); body.append('file', file);
    return request.post<ApiResponse<ApprovalAttachment>>('/v1/approval-files', body, {
      params: sourceId ? { sourceId } : undefined, headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000,
      onUploadProgress: event => onProgress?.(Math.round((event.loaded / (event.total || file.size)) * 100)),
    });
  },
  list: (id: string) => request.get<ApiResponse<ApprovalAttachment[]>>(`/v1/approvals/${id}/files`),
  download: (id: string, purpose: 'PREVIEW' | 'DOWNLOAD' = 'DOWNLOAD') => request.get<ApiResponse<ApprovalAttachment & { base64: string }>>(`/v1/approval-files/${id}`, { params: { purpose }, timeout: 60000 }),
  remove: (id: string) => request.delete<ApiResponse<{ id: string }>>(`/v1/approval-files/${id}`),
  clone: (id: string) => request.post<ApiResponse<ApprovalAttachment>>(`/v1/approval-files/${id}/clone`, {}, { timeout: 60000 }),
  material: (id: string) => request.get<ApiResponse<ApprovalMaterial>>(`/v1/approvals/${id}/material`),
};

export function decodeAttachment(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
