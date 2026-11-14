import { inPreviewFrame } from '@/features/authorization/preview-frame';
import axios from 'axios';

export interface RuntimeCredentials {
  token: string;
  csrfToken: string;
  expiresIn: number;
}

type RefreshLoader = () => Promise<RuntimeCredentials>;
type Listener = () => void;

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshRequest: Promise<string> | null = null;
const listeners = new Set<Listener>();

function purgeLegacyStorage(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('law_firm_token');
  localStorage.removeItem('law_firm_refresh_token');
  localStorage.removeItem('auth-storage');
}

function cookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

async function defaultRefresh(): Promise<RuntimeCredentials> {
  const csrf = csrfToken ?? cookieValue('chengye_csrf');
  const response = await axios.post<{
    code: number;
    data: RuntimeCredentials;
  }>('/api/v1/auth/refresh', {}, {
    withCredentials: true,
    headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
  });
  if (response.data.code !== 200) throw new Error('SESSION_REFRESH_FAILED');
  return response.data.data;
}

function notify(): void {
  listeners.forEach(listener => listener());
}

purgeLegacyStorage();

export const runtimeSession = {
  getAccessToken: () => accessToken,
  getCsrfToken: () => csrfToken ?? cookieValue('chengye_csrf'),

  setAuthenticated(credentials: RuntimeCredentials): void {
    purgeLegacyStorage();
    accessToken = credentials.token;
    csrfToken = credentials.csrfToken;
    notify();
  },

  clear(): void {
    purgeLegacyStorage();
    accessToken = null;
    csrfToken = null;
    refreshRequest = null;
    notify();
  },

  refreshOnce(loader: RefreshLoader = defaultRefresh): Promise<string> {
    if (inPreviewFrame) return Promise.reject(new Error('预览会话不可刷新'));
    if (refreshRequest) return refreshRequest;
    refreshRequest = loader()
      .then(credentials => {
        this.setAuthenticated(credentials);
        return credentials.token;
      })
      .catch(error => {
        this.clear();
        throw error;
      })
      .finally(() => {
        refreshRequest = null;
      });
    return refreshRequest;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
