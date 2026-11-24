import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'cashtrace_supabase_url';
const STORAGE_ANON_KEY = 'cashtrace_supabase_anon_key';

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
  source: 'env' | 'local' | 'unconfigured';
}

export function getSupabaseConfig(): SupabaseRuntimeConfig {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '';
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

  if (
    envUrl &&
    envKey &&
    !envUrl.includes('your-project-id') &&
    !envKey.includes('your-supabase-anon-key')
  ) {
    return { url: envUrl, anonKey: envKey, source: 'env' };
  }

  if (typeof window !== 'undefined') {
    const localUrl = window.localStorage.getItem(STORAGE_URL_KEY)?.trim() || '';
    const localKey = window.localStorage.getItem(STORAGE_ANON_KEY)?.trim() || '';
    if (localUrl && localKey) {
      return { url: localUrl, anonKey: localKey, source: 'local' };
    }
  }

  return { url: '', anonKey: '', source: 'unconfigured' };
}

export function saveSupabaseRuntimeConfig(url: string, anonKey: string): void {
  if (typeof window === 'undefined') return;
  const cleanUrl = url.trim();
  const cleanKey = anonKey.trim();
  if (cleanUrl && cleanKey) {
    window.localStorage.setItem(STORAGE_URL_KEY, cleanUrl);
    window.localStorage.setItem(STORAGE_ANON_KEY, cleanKey);
  } else {
    window.localStorage.removeItem(STORAGE_URL_KEY);
    window.localStorage.removeItem(STORAGE_ANON_KEY);
  }
  cachedClient = null;
  cachedConfigKey = '';
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, source } = getSupabaseConfig();
  if (source === 'unconfigured' || !url || !anonKey) {
    return null;
  }

  const key = `${url}::${anonKey}`;
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    cachedConfigKey = key;
    return cachedClient;
  } catch {
    return null;
  }
}
