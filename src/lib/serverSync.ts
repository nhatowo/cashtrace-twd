import { Banknote, BanknoteStatus, Denomination } from '@/types/banknote';

export const DEFAULT_SERVER_URL = 'http://18.142.115.74';
const SERVER_URL_KEY = 'cashtrace_server_url';
const SERVER_TOKEN_KEY = 'cashtrace_server_token';
const SERVER_EMAIL_KEY = 'cashtrace_server_email';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = window.localStorage.getItem(SERVER_URL_KEY)?.trim();
    if (custom) return custom.replace(/\/+$/, '');
    // If hosted directly on the AWS server via browser, use same-origin relative path
    if (
      window.location.hostname === '18.142.115.74' ||
      (window.location.protocol.startsWith('http') &&
        window.location.hostname !== 'localhost')
    ) {
      return window.location.origin;
    }
  }
  return DEFAULT_SERVER_URL;
}

export function getServerAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(SERVER_TOKEN_KEY) || '';
}

export function getServerUserEmail(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SERVER_EMAIL_KEY);
}

export function setServerAuthSession(token: string, email: string): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(SERVER_TOKEN_KEY, token);
    window.localStorage.setItem(SERVER_EMAIL_KEY, email);
  } else {
    window.localStorage.removeItem(SERVER_TOKEN_KEY);
    window.localStorage.removeItem(SERVER_EMAIL_KEY);
  }
}

function getHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getServerAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function serverFetchBanknotes(): Promise<{
  banknotes: Banknote[];
  userEmail: string;
}> {
  const res = await fetch(`${getApiBaseUrl()}/api/banknotes`, {
    method: 'GET',
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Không thể kết nối tới máy chủ đồng bộ');
  }
  const data = await res.json();
  return {
    banknotes: (data.banknotes || []) as Banknote[],
    userEmail: data.user?.email || 'Ví chung (18.142.115.74)',
  };
}

export async function serverInsertBanknote(
  serial_number: string,
  denomination: Denomination
): Promise<Banknote> {
  const res = await fetch(`${getApiBaseUrl()}/api/banknotes`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      serial_number,
      denomination,
      status: 'HELD',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Không thể lưu tờ tiền lên server') as Error & {
      code?: string;
    };
    err.code = data.code;
    throw err;
  }
  return data.banknote as Banknote;
}

export async function serverUpdateBanknoteStatus(
  id: string,
  status: BanknoteStatus
): Promise<Banknote> {
  const res = await fetch(`${getApiBaseUrl()}/api/banknotes/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Không thể cập nhật trạng thái');
  }
  return data.banknote as Banknote;
}

export async function serverDeleteBanknote(id: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/api/banknotes/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Không thể xóa tờ tiền');
  }
}

export async function serverLoginOrRegister(
  mode: 'login' | 'register',
  email: string,
  password: string
): Promise<{ token: string; email: string }> {
  const res = await fetch(`${getApiBaseUrl()}/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Lỗi xác thực tài khoản');
  }
  setServerAuthSession(data.token, data.user.email);
  return { token: data.token, email: data.user.email };
}
