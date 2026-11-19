import { isAxiosError } from 'axios';

export function isTransientRequestError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? '');
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
