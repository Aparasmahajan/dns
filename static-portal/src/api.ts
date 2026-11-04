/**
 * Static portal: the same API calls as the real portal, but answered inside the browser
 * (src/mock/server.ts) with all data in localStorage. No network, no backend.
 */
import { ApiError } from './mock/errors';
import { handleRequest } from './mock/server';

export { ApiError };

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(method: Method, url: string, body?: unknown): Promise<T> {
  try {
    return (await handleRequest(method, url, body)) as T;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('portal:unauthorized'));
    }
    throw e;
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** Tell the shell (badges, counters) that data changed. */
export function notifyChanged() {
  window.dispatchEvent(new CustomEvent('portal:changed'));
}
