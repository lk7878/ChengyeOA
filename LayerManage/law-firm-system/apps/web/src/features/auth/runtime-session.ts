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
let credentialEpoch = 0;
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
  const csrf = cookieValue('chengye_csrf') ?? csrfToken;
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
  getCsrfToken: () => cookieValue('chengye_csrf') ?? csrfToken,

  setAuthenticated(credentials: RuntimeCredentials): void {
    credentialEpoch++;
    purgeLegacyStorage();
    accessToken = credentials.token;
    csrfToken = credentials.csrfToken;
    notify();
  },

  clear(): void {
    credentialEpoch++;
    purgeLegacyStorage();
    accessToken = null;
    csrfToken = null;
    refreshRequest = null;
    notify();
  },

  refreshOnce(loader: RefreshLoader = defaultRefresh): Promise<string> {
    if (inPreviewFrame) return Promise.reject(new Error('预览会话不可刷新'));
    if (refreshRequest) return refreshRequest;
    const startedEpoch = credentialEpoch;
    refreshRequest = loader()
      .then(credentials => {
        if (credentialEpoch !== startedEpoch) {
          if (accessToken) return accessToken;
          throw new Error('SESSION_CHANGED');
        }
        this.setAuthenticated(credentials);
        return credentials.token;
      })
      .catch(error => {
        if (credentialEpoch !== startedEpoch && accessToken) return accessToken;
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
