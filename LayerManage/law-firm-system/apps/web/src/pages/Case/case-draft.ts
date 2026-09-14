import type { UploadFile } from 'antd';
import { useAuthStore } from '@/stores/authStore';

// Memory only: retain File objects during the customer-management round trip.
// Never put case descriptions, phone numbers or attachments into localStorage/URLs.
export const caseDraft: {
  ownerId?: string;
  values?: Record<string, unknown>;
  attachments?: Record<string, UploadFile[]>;
} = {};

export function clearCaseDraft() {
  delete caseDraft.ownerId;
  delete caseDraft.values;
  delete caseDraft.attachments;
}

useAuthStore.subscribe((state, previous) => {
  if (state.userInfo?.id !== previous.userInfo?.id || (!state.isAuthenticated && previous.isAuthenticated)) clearCaseDraft();
});
