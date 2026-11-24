'use client';

import React, { useState } from 'react';
import {
  X,
  LogIn,
  UserPlus,
  Database,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Cloud,
  Server,
} from 'lucide-react';
import {
  getSupabaseClient,
  getSupabaseConfig,
  saveSupabaseRuntimeConfig,
} from '@/lib/supabase';
import {
  DEFAULT_SERVER_URL,
  serverLoginOrRegister,
  setServerAuthSession,
} from '@/lib/serverSync';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string | null;
  onAuthChange: () => void;
}

export default function AuthModal({
  isOpen,
  onClose,
  userEmail,
  onAuthChange,
}: AuthModalProps) {
  const currentConfig = getSupabaseConfig();

  const [tab, setTab] = useState<'login' | 'signup' | 'config'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [supabaseUrl, setSupabaseUrl] = useState(currentConfig.url);
  const [supabaseKey, setSupabaseKey] = useState(currentConfig.anonKey);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!supabaseUrl.trim() && !supabaseKey.trim()) {
      saveSupabaseRuntimeConfig('', '');
      setMessage({
        type: 'success',
        text: `Đã chuyển về Máy chủ Ubuntu mặc định (${DEFAULT_SERVER_URL}).`,
      });
      onAuthChange();
      return;
    }

    if (!supabaseUrl.trim().startsWith('http') || !supabaseKey.trim()) {
      setMessage({
        type: 'error',
        text: 'Vui lòng nhập đầy đủ Supabase Project URL và Anon Key hợp lệ (hoặc để trống để dùng Ubuntu Server 18.142.115.74).',
      });
      return;
    }

    saveSupabaseRuntimeConfig(supabaseUrl, supabaseKey);
    setMessage({
      type: 'success',
      text: 'Đã lưu cấu hình Supabase!',
    });
    onAuthChange();
    setTimeout(() => setTab('login'), 800);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const supabase = getSupabaseClient();
    try {
      if (supabase) {
        if (tab === 'login') {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
          });
          if (error) throw error;
        }
      } else {
        // Authenticate directly against the Ubuntu server 18.142.115.74
        await serverLoginOrRegister(
          tab === 'login' ? 'login' : 'register',
          email.trim(),
          password
        );
      }

      setMessage({
        type: 'success',
        text:
          tab === 'login'
            ? 'Đăng nhập thành công! Đang đồng bộ dữ liệu...'
            : 'Đăng ký và đăng nhập thành công!',
      });
      onAuthChange();
      setTimeout(onClose, 600);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Không thể xác thực. Vui lòng kiểm tra lại thông tin.';
      setMessage({
        type: 'error',
        text: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setServerAuthSession('', '');
    onAuthChange();
    onClose();
  };

  const isCustomAccount =
    userEmail && !userEmail.includes('Ví chung') && !userEmail.includes('Chưa');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Đồng bộ Máy chủ &amp; Tài khoản
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active Server Banner */}
        <div className="px-5 py-2.5 bg-emerald-950/40 border-b border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-300">
          <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            Máy chủ đang kết nối:{' '}
            <strong className="font-mono">
              {currentConfig.source !== 'unconfigured'
                ? 'Supabase Cloud'
                : 'Ubuntu 18.142.115.74'}
            </strong>
          </span>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1 p-1.5 bg-slate-950/60 border-b border-slate-800 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setMessage(null);
            }}
            className={`py-2 rounded-lg transition ${
              tab === 'login'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('signup');
              setMessage(null);
            }}
            className={`py-2 rounded-lg transition ${
              tab === 'signup'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Đăng ký
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('config');
              setMessage(null);
            }}
            className={`py-2 rounded-lg transition ${
              tab === 'config'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cấu hình Supabase
          </button>
        </div>

        <div className="p-5">
          {message && (
            <div
              className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                message.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          {isCustomAccount && tab !== 'config' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                <p className="text-xs text-slate-400 mb-1">
                  Đang đồng bộ với tài khoản riêng:
                </p>
                <p className="text-sm font-semibold text-emerald-300 break-all">
                  {userEmail}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Dữ liệu tiền mặt TWD của bạn đang được đồng bộ thời gian thực giữa iPhone và máy tính.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full py-3 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-sm font-semibold flex items-center justify-center gap-2 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Đăng xuất về Ví chung Server</span>
              </button>
            </div>
          ) : tab === 'config' ? (
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <p className="text-xs text-slate-400 leading-relaxed">
                Mặc định ứng dụng tự động đồng bộ qua máy chủ Ubuntu{' '}
                <code className="text-emerald-300">18.142.115.74</code>. Nếu
                muốn chuyển sang Supabase riêng, hãy nhập URL &amp; Anon Key bên
                dưới:
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Supabase Project URL (Để trống để dùng Server 18.142.115.74)
                </label>
                <input
                  type="url"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://xyzcompany.supabase.co"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Supabase Anon Public Key
                </label>
                <input
                  type="password"
                  value={supabaseKey}
                  onChange={(e) => setSupabaseKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
              >
                <Database className="w-4 h-4" />
                <span>Lưu cấu hình máy chủ</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-3.5">
              <p className="text-xs text-slate-400">
                Hiện đang dùng{' '}
                <strong className="text-emerald-300">
                  Ví chung tự động trên Server 18.142.115.74
                </strong>
                . Bạn cũng có thể đăng nhập tài khoản riêng bên dưới:
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ban@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mật khẩu
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
              >
                {tab === 'login' ? (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>{loading ? 'Đang tạo tài khoản...' : 'Tạo tài khoản mới'}</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
