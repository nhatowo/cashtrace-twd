'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Camera,
  Search,
  Check,
  RotateCcw,
  Cloud,
  CloudOff,
  RefreshCw,
  Plus,
  X,
  AlertCircle,
  Banknote as BanknoteIcon,
  Sparkles,
  Download,
  Trash2,
  Eye,
  Clock,
  FileText,
  ClipboardCheck,
} from 'lucide-react';
import {
  Banknote,
  BanknoteStatus,
  Denomination,
  DENOMINATION_STYLES,
  SUPPORTED_DENOMINATIONS,
  formatTWD,
  formatDateTimeVN,
  normalizeSerialNumber,
} from '@/types/banknote';
import { getSupabaseClient } from '@/lib/supabase';
import {
  serverFetchBanknotes,
  serverInsertBanknote,
  serverUpdateBanknoteStatus,
  serverDeleteBanknote,
} from '@/lib/serverSync';
import { OcrScanResult } from '@/lib/ocr';
import CameraScannerModal from '@/components/CameraScannerModal';
import AuthModal from '@/components/AuthModal';
import AuditCheckModal from '@/components/AuditCheckModal';

const LOCAL_STORAGE_KEY = 'cashtrace_banknotes_v1';

export default function CashTracePage() {
  // Data state
  const [banknotes, setBanknotes] = useState<Banknote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [serverOnline, setServerOnline] = useState<boolean>(false);

  // Auth & Cloud Sync state
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Scanner & Add/Correct OCR form state
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [serialInput, setSerialInput] = useState<string>('');
  const [selectedDenom, setSelectedDenom] = useState<Denomination>(1000);
  const [noteInput, setNoteInput] = useState<string>('');
  const [ocrResult, setOcrResult] = useState<OcrScanResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Image Viewer Modal state
  const [viewingNoteImage, setViewingNoteImage] = useState<Banknote | null>(
    null
  );

  // Cash Audit / Missing Bill Checker Modal state
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BanknoteStatus>('ALL');

  // Undo toast banner state
  const [undoToast, setUndoToast] = useState<{
    banknote: Banknote;
    previousStatus: BanknoteStatus;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serialInputRef = useRef<HTMLInputElement | null>(null);

  // Register PWA Service Worker
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore SW errors
      });
    }
  }, []);

  const loadLocalBanknotes = useCallback((): Banknote[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Banknote[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const saveLocalBanknotes = useCallback((items: Banknote[]) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore quota errors
    }
  }, []);

  // Fetch banknotes from Supabase (if configured) OR AWS Server 18.142.115.74
  const fetchBanknotes = useCallback(async () => {
    setSyncing(true);
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user) {
          setUserId(session.user.id);
          setUserEmail(session.user.email || 'Đã đăng nhập Supabase');

          const { data, error } = await supabase
            .from('banknotes')
            .select('*')
            .order('created_at', { ascending: false });

          if (error) throw error;
          const remoteList = (data || []) as Banknote[];
          setBanknotes(remoteList);
          saveLocalBanknotes(remoteList);
          setServerOnline(true);
          setLoading(false);
          setSyncing(false);
          return;
        }
      } catch {
        // Fall through to AWS server sync
      }
    }

    try {
      const { banknotes: remoteNotes, userEmail: srvEmail } =
        await serverFetchBanknotes();
      setBanknotes(remoteNotes);
      saveLocalBanknotes(remoteNotes);
      setUserId('server_sync');
      setUserEmail(srvEmail);
      setServerOnline(true);
    } catch {
      const localItems = loadLocalBanknotes();
      setBanknotes(localItems);
      setServerOnline(false);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [loadLocalBanknotes, saveLocalBanknotes]);

  // Initial load + periodic 6s sync across mobile & desktop
  useEffect(() => {
    fetchBanknotes();

    const interval = setInterval(() => {
      fetchBanknotes();
    }, 6000);

    const supabase = getSupabaseClient();
    if (!supabase) {
      return () => clearInterval(interval);
    }

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(() => {
      fetchBanknotes();
    });

    const channel = supabase
      .channel('banknotes-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banknotes' },
        () => {
          fetchBanknotes();
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      authSub.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [fetchBanknotes]);

  // Calculate total money currently HELD (Feature 10)
  const { totalHeldTWD, heldCount, spentCount } = useMemo(() => {
    let total = 0;
    let held = 0;
    let spent = 0;
    for (const note of banknotes) {
      if (note.status === 'HELD') {
        total += Number(note.denomination);
        held += 1;
      } else {
        spent += 1;
      }
    }
    return { totalHeldTWD: total, heldCount: held, spentCount: spent };
  }, [banknotes]);

  // Filter & Search by serial number (or note)
  const filteredBanknotes = useMemo(() => {
    const query = normalizeSerialNumber(searchQuery);
    const rawQueryLower = searchQuery.trim().toLowerCase();
    return banknotes.filter((note) => {
      if (statusFilter !== 'ALL' && note.status !== statusFilter) {
        return false;
      }
      if (!rawQueryLower) return true;
      const serialMatch =
        query.length > 0 &&
        normalizeSerialNumber(note.serial_number).includes(query);
      const noteMatch =
        note.note && note.note.toLowerCase().includes(rawQueryLower);
      return Boolean(serialMatch || noteMatch);
    });
  }, [banknotes, searchQuery, statusFilter]);

  // Handle OCR Scan completion (Features 1 & 2)
  const handleScanComplete = (result: OcrScanResult) => {
    setIsScannerOpen(false);
    setOcrResult(result);
    setSerialInput(result.serialNumber);
    setFormError(null);

    setTimeout(() => {
      serialInputRef.current?.focus();
    }, 120);
  };

  // Save banknote with scanned image, optional note, and duplicate prevention
  const handleSaveBanknote = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanedSerial = normalizeSerialNumber(serialInput);
    if (cleanedSerial.length < 4) {
      setFormError('Vui lòng nhập đầy đủ số seri (tối thiểu 4 ký tự chữ/số).');
      return;
    }

    if (!SUPPORTED_DENOMINATIONS.includes(selectedDenom)) {
      setFormError('Mệnh giá chỉ hỗ trợ 100, 500, 1000 hoặc 2000 TWD.');
      return;
    }

    // Prevent duplicate serial numbers (Feature 5)
    const isDuplicate = banknotes.some(
      (b) => normalizeSerialNumber(b.serial_number) === cleanedSerial
    );
    if (isDuplicate) {
      setFormError(`Số seri "${cleanedSerial}" đã tồn tại trong danh sách!`);
      return;
    }

    const trimmedNote = noteInput.trim() || null;
    const scannedImageData = ocrResult?.previewDataUrl || null;

    setIsSaving(true);
    const supabase = getSupabaseClient();

    try {
      if (supabase && userId && userId !== 'server_sync') {
        const { data, error } = await supabase
          .from('banknotes')
          .insert({
            user_id: userId,
            serial_number: cleanedSerial,
            denomination: selectedDenom,
            status: 'HELD',
            note: trimmedNote,
            scan_image: scannedImageData,
          })
          .select('*')
          .single();

        if (error) {
          if (error.code === '23505') {
            setFormError(`Số seri "${cleanedSerial}" đã tồn tại trên hệ thống!`);
            setIsSaving(false);
            return;
          }
          throw error;
        }

        const created = data as Banknote;
        const updated = [created, ...banknotes];
        setBanknotes(updated);
        saveLocalBanknotes(updated);
      } else {
        try {
          const created = await serverInsertBanknote(
            cleanedSerial,
            selectedDenom,
            trimmedNote,
            scannedImageData
          );
          const updated = [created, ...banknotes];
          setBanknotes(updated);
          saveLocalBanknotes(updated);
          setServerOnline(true);
        } catch (srvErr: unknown) {
          const errWithCode = srvErr as Error & { code?: string };
          if (errWithCode?.code === '23505') {
            setFormError(`Số seri "${cleanedSerial}" đã tồn tại trên hệ thống!`);
            setIsSaving(false);
            return;
          }
          // Offline fallback
          const newNote: Banknote = {
            id:
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `note_${Date.now()}`,
            user_id: 'local',
            serial_number: cleanedSerial,
            denomination: selectedDenom,
            status: 'HELD',
            note: trimmedNote,
            scan_image: scannedImageData,
            created_at: new Date().toISOString(),
          };
          const updated = [newNote, ...banknotes];
          setBanknotes(updated);
          saveLocalBanknotes(updated);
        }
      }

      setSerialInput('');
      setNoteInput('');
      setOcrResult(null);
      setFormError(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Không thể lưu tờ tiền. Vui lòng thử lại.';
      setFormError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Update banknote status: Mark as SPENT with one tap or UNDO back to HELD
  const updateBanknoteStatus = async (
    note: Banknote,
    nextStatus: BanknoteStatus,
    showUndoBanner = true
  ) => {
    const previousStatus = note.status;
    if (previousStatus === nextStatus) return;

    const optimistic = banknotes.map((item) =>
      item.id === note.id
        ? { ...item, status: nextStatus, updated_at: new Date().toISOString() }
        : item
    );
    setBanknotes(optimistic);
    saveLocalBanknotes(optimistic);

    if (showUndoBanner && nextStatus === 'SPENT') {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndoToast({ banknote: note, previousStatus });
      undoTimerRef.current = setTimeout(() => {
        setUndoToast(null);
      }, 7000);
    } else if (nextStatus === 'HELD' && undoToast?.banknote.id === note.id) {
      setUndoToast(null);
    }

    const supabase = getSupabaseClient();
    if (
      supabase &&
      userId &&
      userId !== 'server_sync' &&
      note.user_id !== 'local'
    ) {
      const { error } = await supabase
        .from('banknotes')
        .update({ status: nextStatus })
        .eq('id', note.id);

      if (error) {
        const reverted = banknotes.map((item) =>
          item.id === note.id ? { ...item, status: previousStatus } : item
        );
        setBanknotes(reverted);
        saveLocalBanknotes(reverted);
      }
    } else if (note.user_id !== 'local') {
      try {
        await serverUpdateBanknoteStatus(note.id, nextStatus);
      } catch {
        // Keep optimistic state locally
      }
    }
  };

  // Permanently delete a banknote so its serial number can be added again later
  const deleteBanknotePermanently = async (note: Banknote) => {
    const updated = banknotes.filter((item) => item.id !== note.id);
    setBanknotes(updated);
    saveLocalBanknotes(updated);

    if (undoToast?.banknote.id === note.id) {
      setUndoToast(null);
    }
    if (viewingNoteImage?.id === note.id) {
      setViewingNoteImage(null);
    }

    const supabase = getSupabaseClient();
    if (
      supabase &&
      userId &&
      userId !== 'server_sync' &&
      note.user_id !== 'local'
    ) {
      await supabase.from('banknotes').delete().eq('id', note.id);
    } else if (note.user_id !== 'local') {
      try {
        await serverDeleteBanknote(note.id);
      } catch {
        // Already removed locally
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100 pb-28 safe-top">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-[#090d16]/90 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-mono font-bold text-sm shrink-0">
              NT$
            </div>
            <div className="truncate">
              <h1 className="text-base font-bold tracking-tight text-white leading-none">
                CashTrace
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                Theo dõi Tiền Đài Loan (TWD)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href="/CashTrace-Signed.ipa"
              download
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/40 text-xs font-medium text-emerald-300 flex items-center gap-1 transition"
              title="Tải file CashTrace-Signed.ipa cho iOS"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tải IPA iOS</span>
              <span className="sm:hidden">IPA</span>
            </a>

            <button
              type="button"
              onClick={fetchBanknotes}
              disabled={syncing}
              title="Làm mới & đồng bộ"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition"
              aria-label="Đồng bộ dữ liệu"
            >
              <RefreshCw
                className={`w-4 h-4 ${syncing ? 'animate-spin text-emerald-400' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition ${
                serverOnline
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              {serverOnline ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Đã đồng bộ</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>Đồng bộ</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 pt-4 space-y-4">
        {/* Total Money Currently HELD Card (Feature 10) + Cash Audit Button */}
        <section className="rounded-2xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-900 border border-emerald-500/30 p-5 shadow-xl space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-emerald-300/90">
              Tổng tiền đang giữ
            </span>
            <span className="text-xs font-medium text-slate-400">
              {heldCount} tờ đang giữ • {spentCount} tờ đã tiêu
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-mono">
              {formatTWD(totalHeldTWD)}
            </span>

            <button
              type="button"
              onClick={() => setIsAuditModalOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 border border-emerald-400/40 text-emerald-200 text-xs font-bold flex items-center gap-2 shadow-sm transition"
            >
              <ClipboardCheck className="w-4 h-4 text-emerald-400" />
              <span>Kiểm tiền / Đối chiếu ({heldCount} tờ)</span>
            </button>
          </div>
        </section>

        {/* Large Scan Button + Quick Entry / OCR Correction Card */}
        <section className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 space-y-4 shadow-lg">
          {/* Large Prominent Camera Scan CTA */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-full py-4 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-base flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20 transition"
          >
            <Camera className="w-6 h-6 stroke-[2.2]" />
            <span>Quét Số Seri Bằng Camera</span>
          </button>

          {/* OCR Scan Preview & Correction Notice */}
          {ocrResult && (
            <div className="p-3 rounded-xl bg-slate-950/90 border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  Ảnh đã quét (Độ tin cậy: {ocrResult.confidence}%) — Sẽ tự động lưu kèm tờ tiền:
                </span>
                <button
                  type="button"
                  onClick={() => setOcrResult(null)}
                  className="text-slate-400 hover:text-white p-0.5"
                  aria-label="Xóa ảnh quét"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {ocrResult.previewDataUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={ocrResult.previewDataUrl}
                  alt="Ảnh vùng số seri đã quét"
                  className="w-full max-h-24 object-contain rounded-lg border border-slate-800 bg-black"
                />
              )}
            </div>
          )}

          {/* Form to Edit Serial Number, Select Denomination, and Add Optional Note */}
          <form onSubmit={handleSaveBanknote} className="space-y-3.5">
            <div>
              <label
                htmlFor="serial-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Số seri tờ tiền (chỉnh sửa nếu OCR nhận diện nhầm)
              </label>
              <div className="relative">
                <input
                  id="serial-input"
                  ref={serialInputRef}
                  type="text"
                  value={serialInput}
                  onChange={(e) => {
                    setSerialInput(e.target.value.toUpperCase());
                    if (formError) setFormError(null);
                  }}
                  placeholder="VD: TY328954HR"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-3.5 py-3 rounded-xl bg-slate-950 border border-slate-700/90 text-base font-mono font-bold tracking-wider text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 uppercase"
                />
                {serialInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSerialInput('');
                      setFormError(null);
                      serialInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                    aria-label="Xóa số seri"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Select Denomination from 4 options ONLY: 100, 500, 1000, 2000 TWD */}
            <div>
              <span className="block text-xs font-medium text-slate-300 mb-1.5">
                Chọn mệnh giá (TWD)
              </span>
              <div className="grid grid-cols-4 gap-2">
                {SUPPORTED_DENOMINATIONS.map((denom) => {
                  const style = DENOMINATION_STYLES[denom];
                  const isSelected = selectedDenom === denom;
                  return (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => setSelectedDenom(denom)}
                      className={`py-2.5 px-2 rounded-xl border text-center font-mono font-bold text-sm transition ${
                        isSelected
                          ? style.activeRing
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {denom}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Note Field */}
            <div>
              <label
                htmlFor="note-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Ghi chú (tuỳ chọn)
              </label>
              <div className="relative">
                <input
                  id="note-input"
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="VD: Tiền rút cây ATM, Tiền bạn gửi..."
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700/90 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
                {noteInput && (
                  <button
                    type="button"
                    onClick={() => setNoteInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                    aria-label="Xóa ghi chú"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Error Alert (e.g. duplicate serial number) */}
            {formError && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Save Button */}
            <button
              type="submit"
              disabled={isSaving || !serialInput.trim()}
              className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-white disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isSaving
                  ? 'Đang lưu...'
                  : `Lưu tờ ${formatTWD(selectedDenom)} (Đang giữ)`}
              </span>
            </button>
          </form>
        </section>

        {/* Search & Status Filter Section */}
        <section className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo số seri hoặc ghi chú..."
              className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label="Xóa tìm kiếm"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`py-2 rounded-lg transition ${
                statusFilter === 'ALL'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({banknotes.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('HELD')}
              className={`py-2 rounded-lg transition ${
                statusFilter === 'HELD'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đang giữ ({heldCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('SPENT')}
              className={`py-2 rounded-lg transition ${
                statusFilter === 'SPENT'
                  ? 'bg-slate-800 text-slate-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Đã tiêu ({spentCount})
            </button>
          </div>
        </section>

        {/* Banknotes List */}
        <section className="space-y-2.5">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Đang tải danh sách tờ tiền...
            </div>
          ) : filteredBanknotes.length === 0 ? (
            <div className="rounded-2xl bg-slate-900/50 border border-slate-800/80 p-8 text-center space-y-2">
              <BanknoteIcon className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-300">
                {searchQuery
                  ? 'Không tìm thấy tờ tiền nào khớp từ khóa này'
                  : 'Chưa có tờ tiền nào được lưu'}
              </p>
              <p className="text-xs text-slate-500">
                Nhấn &ldquo;Quét Số Seri Bằng Camera&rdquo; hoặc nhập số seri ở trên để bắt đầu.
              </p>
            </div>
          ) : (
            filteredBanknotes.map((note) => {
              const denomStyle =
                DENOMINATION_STYLES[note.denomination] ||
                DENOMINATION_STYLES[100];
              const isHeld = note.status === 'HELD';
              const timeStr = formatDateTimeVN(note.created_at);

              return (
                <div
                  key={note.id}
                  className={`rounded-2xl border p-3.5 flex flex-col gap-2.5 transition ${
                    isHeld
                      ? 'bg-slate-900/90 border-slate-800'
                      : 'bg-slate-900/40 border-slate-800/50 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${denomStyle.badgeBg} ${denomStyle.badgeText} ${denomStyle.border}`}
                        >
                          {note.denomination} TWD
                        </span>

                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            isHeld
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {isHeld ? 'ĐANG GIỮ' : 'ĐÃ TIÊU'}
                        </span>

                        {timeStr && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>{timeStr}</span>
                          </span>
                        )}
                      </div>

                      <p
                        className={`mt-1.5 font-mono text-base font-bold tracking-wider truncate ${
                          isHeld ? 'text-white' : 'text-slate-400 line-through'
                        }`}
                      >
                        {note.serial_number}
                      </p>

                      {note.note && (
                        <p className="mt-1 text-xs text-slate-300 flex items-start gap-1.5 break-words">
                          <FileText className="w-3.5 h-3.5 text-emerald-400/80 shrink-0 mt-0.5" />
                          <span>{note.note}</span>
                        </p>
                      )}
                    </div>

                    {/* Action Buttons: View Image (if exists), Spent/Undo, Permanent Delete */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {note.scan_image && (
                        <button
                          type="button"
                          onClick={() => setViewingNoteImage(note)}
                          title="Xem lại ảnh thực tế lúc quét"
                          className="py-2.5 px-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1 transition"
                        >
                          <Eye className="w-4 h-4" />
                          <span className="hidden sm:inline">Xem ảnh</span>
                        </button>
                      )}

                      {isHeld ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateBanknoteStatus(note, 'SPENT', true)
                          }
                          className="py-2.5 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:scale-95 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Check className="w-4 h-4" />
                          <span>Đã tiêu</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            updateBanknoteStatus(note, 'HELD', false)
                          }
                          className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Hoàn tác</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteBanknotePermanently(note)}
                        title="Xóa hẳn tờ tiền này (có thể thêm lại số seri này sau)"
                        aria-label="Xóa hẳn tờ tiền"
                        className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-rose-950/80 active:scale-95 border border-slate-700/80 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>

      {/* View Scanned Image Lightbox Modal */}
      {viewingNoteImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-sm"
          onClick={() => setViewingNoteImage(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Ảnh quét thực tế:</span>
                  <span className="font-mono text-emerald-400">
                    {viewingNoteImage.serial_number}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Mệnh giá: {viewingNoteImage.denomination} TWD • Thêm lúc:{' '}
                  {formatDateTimeVN(viewingNoteImage.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingNoteImage(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {viewingNoteImage.scan_image ? (
                <div className="rounded-xl overflow-hidden border border-slate-800 bg-black flex items-center justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewingNoteImage.scan_image}
                    alt={`Ảnh số seri ${viewingNoteImage.serial_number}`}
                    className="w-full max-h-64 object-contain rounded-lg"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-6">
                  Tờ tiền này được nhập thủ công nên không có ảnh quét.
                </p>
              )}

              {viewingNoteImage.note && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 flex items-start gap-2">
                  <FileText className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-slate-400 font-medium">
                      Ghi chú:{' '}
                    </span>
                    <span>{viewingNoteImage.note}</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setViewingNoteImage(null)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Undo Toast Banner */}
      {undoToast && (
        <div className="fixed bottom-20 inset-x-4 z-40 max-w-md mx-auto">
          <div className="rounded-2xl bg-slate-900 border border-emerald-500/40 shadow-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-200 truncate">
              Đã đánh dấu{' '}
              <span className="font-mono font-bold text-white">
                {undoToast.banknote.serial_number}
              </span>{' '}
              ({undoToast.banknote.denomination} TWD) là{' '}
              <span className="text-rose-300 font-semibold">ĐÃ TIÊU</span>
            </div>
            <button
              type="button"
              onClick={() =>
                updateBanknoteStatus(
                  undoToast.banknote,
                  undoToast.previousStatus,
                  false
                )
              }
              className="shrink-0 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Hoàn tác</span>
            </button>
          </div>
        </div>
      )}

      {/* Persistent Mobile Bottom Bar with Large Scan Action */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-[#090d16]/90 backdrop-blur-md border-t border-slate-800/80 px-4 py-2.5 safe-bottom sm:hidden">
        <button
          type="button"
          onClick={() => setIsScannerOpen(true)}
          className="w-full py-3.5 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
        >
          <Camera className="w-5 h-5" />
          <span>Quét Số Seri Tờ Tiền</span>
        </button>
      </div>

      {/* Camera OCR Modal */}
      <CameraScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanComplete={handleScanComplete}
      />

      {/* Cash Audit & Missing Bill Checker Modal */}
      <AuditCheckModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        banknotes={banknotes}
        onMarkSpent={(note) => updateBanknoteStatus(note, 'SPENT', true)}
        onDeletePermanent={deleteBanknotePermanently}
        onViewImage={(note) => setViewingNoteImage(note)}
      />

      {/* Server & Supabase Auth Configuration Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        userEmail={userEmail}
        onAuthChange={fetchBanknotes}
      />
    </div>
  );
}
