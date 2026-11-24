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
} from 'lucide-react';
import {
  getSupabaseClient,
  getSupabaseConfig,
  saveSupabaseRuntimeConfig,
} from '@/lib/supabase';

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

  const [tab, setTab] = useState<'login' | 'signup' | 'config'>(
    currentConfig.source === 'unconfigured' ? 'config' : 'login'
  );
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

    if (!supabaseUrl.trim().startsWith('http') || !supabaseKey.trim()) {
      setMessage({
        type: 'error',
        text: 'Vui lòng nhập đầy đủ Supabase Project URL và Anon Key hợp lệ.',
      });
      return;
    }

    saveSupabaseRuntimeConfig(supabaseUrl, supabaseKey);
    setMessage({
      type: 'success',
      text: 'Đã lưu cấu hình Supabase! Bây giờ bạn có thể đăng nhập để đồng bộ giữa điện thoại và máy tính.',
    });
    onAuthChange();
    setTimeout(() => setTab('login'), 900);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setMessage({
        type: 'error',
        text: 'Chưa cấu hình kết nối Supabase. Vui lòng nhập URL và Anon Key ở tab Cấu hình.',
      });
      setTab('config');
      return;
    }

    setLoading(true);
    try {
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setMessage({
          type: 'success',
          text: 'Đăng nhập thành công! Đang đồng bộ dữ liệu...',
        });
        onAuthChange();
        setTimeout(onClose, 700);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (data.session) {
          setMessage({
            type: 'success',
            text: 'Đăng ký và đăng nhập thành công!',
          });
          onAuthChange();
          setTimeout(onClose, 700);
        } else {
          setMessage({
            type: 'success',
            text: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản (hoặc đăng nhập ngay nếu đã tắt Confirm Email trên Supabase).',
          });
        }
      }
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
    onAuthChange();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">
              Đồng bộ Đám mây (Supabase)
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
            Cấu hình DB
          </button>
        </div>

        <div className="p-5">
          {/* Status message */}
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

          {/* Logged-in state */}
          {userEmail && tab !== 'config' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
                <p className="text-xs text-slate-400 mb-1">
                  Đang đăng nhập với tài khoản:
                </p>
                <p className="text-sm font-semibold text-emerald-300 break-all">
                  {userEmail}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Dữ liệu tiền mặt TWD của bạn đang được đồng bộ thời gian thực giữa điện thoại và máy tính.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full py-3 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-sm font-semibold flex items-center justify-center gap-2 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>Đăng xuất</span>
              </button>
            </div>
          ) : tab === 'config' ? (
            <form onSubmit={handleSaveConfig} className="space-y-3.5">
              <p className="text-xs text-slate-400 leading-relaxed">
                Nhập thông tin project Supabase (hoặc khai báo trong{' '}
                <code className="text-emerald-300">.env.local</code>) để kích hoạt
                cơ sở dữ liệu đám mây và xác thực tài khoản.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Supabase Project URL
                </label>
                <input
                  type="url"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://xyzcompany.supabase.co"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  required
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
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
              >
                <Database className="w-4 h-4" />
                <span>Lưu cấu hình kết nối</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-3.5">
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
