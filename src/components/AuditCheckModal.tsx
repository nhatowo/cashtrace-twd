'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  Camera,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Check,
  Trash2,
  Eye,
  Clock,
  FileText,
  ClipboardCheck,
  HelpCircle,
} from 'lucide-react';
import {
  Banknote,
  DENOMINATION_STYLES,
  formatTWD,
  formatDateTimeVN,
  normalizeSerialNumber,
} from '@/types/banknote';
import { OcrScanResult } from '@/lib/ocr';
import CameraScannerModal from '@/components/CameraScannerModal';

interface AuditCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  banknotes: Banknote[];
  onMarkSpent: (note: Banknote) => void;
  onDeletePermanent: (note: Banknote) => void;
  onViewImage: (note: Banknote) => void;
}

export default function AuditCheckModal({
  isOpen,
  onClose,
  banknotes,
  onMarkSpent,
  onDeletePermanent,
  onViewImage,
}: AuditCheckModalProps) {
  const [verifiedSerials, setVerifiedSerials] = useState<Set<string>>(
    () => new Set()
  );
  const [unknownSerials, setUnknownSerials] = useState<string[]>([]);
  const [manualSerial, setManualSerial] = useState('');
  const [lastFeedback, setLastFeedback] = useState<{
    type: 'matched' | 'already' | 'spent' | 'unknown';
    text: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'MISSING' | 'VERIFIED'>('MISSING');
  const [isAuditCameraOpen, setIsAuditCameraOpen] = useState(false);

  // All currently HELD banknotes that should be physically in the user's hand/wallet
  const heldBanknotes = useMemo(
    () => banknotes.filter((b) => b.status === 'HELD'),
    [banknotes]
  );

  const {
    missingNotes,
    verifiedNotes,
    totalHeldAmount,
    verifiedAmount,
    missingAmount,
  } = useMemo(() => {
    const missing: Banknote[] = [];
    const verified: Banknote[] = [];
    let totalAmt = 0;
    let verAmt = 0;
    let missAmt = 0;

    for (const note of heldBanknotes) {
      const norm = normalizeSerialNumber(note.serial_number);
      const amt = Number(note.denomination);
      totalAmt += amt;
      if (verifiedSerials.has(norm)) {
        verified.push(note);
        verAmt += amt;
      } else {
        missing.push(note);
        missAmt += amt;
      }
    }

    return {
      missingNotes: missing,
      verifiedNotes: verified,
      totalHeldAmount: totalAmt,
      verifiedAmount: verAmt,
      missingAmount: missAmt,
    };
  }, [heldBanknotes, verifiedSerials]);

  if (!isOpen) return null;

  const verifySerialString = (rawSerial: string) => {
    const cleaned = normalizeSerialNumber(rawSerial);
    if (cleaned.length < 4) return;

    const matchedHeld = heldBanknotes.find(
      (b) => normalizeSerialNumber(b.serial_number) === cleaned
    );

    if (matchedHeld) {
      if (verifiedSerials.has(cleaned)) {
        setLastFeedback({
          type: 'already',
          text: `Tờ ${cleaned} (${matchedHeld.denomination} TWD) đã được kiểm trước đó!`,
        });
      } else {
        setVerifiedSerials((prev) => {
          const next = new Set(prev);
          next.add(cleaned);
          return next;
        });
        setLastFeedback({
          type: 'matched',
          text: `✓ Đã khớp tờ ${cleaned} (${matchedHeld.denomination} TWD)!`,
        });
      }
      return;
    }

    // Check if it was marked SPENT earlier
    const matchedSpent = banknotes.find(
      (b) =>
        b.status === 'SPENT' &&
        normalizeSerialNumber(b.serial_number) === cleaned
    );
    if (matchedSpent) {
      setLastFeedback({
        type: 'spent',
        text: `⚠️ Tờ ${cleaned} (${matchedSpent.denomination} TWD) đang ở trạng thái ĐÃ TIÊU trong danh sách!`,
      });
      return;
    }

    // Otherwise unknown bill not in database
    setUnknownSerials((prev) =>
      prev.includes(cleaned) ? prev : [cleaned, ...prev]
    );
    setLastFeedback({
      type: 'unknown',
      text: `❓ Số seri ${cleaned} chưa có trong danh sách lưu trữ!`,
    });
  };

  const handleAuditCameraScan = (result: OcrScanResult) => {
    verifySerialString(result.serialNumber);
  };

  const handleManualVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSerial.trim()) return;
    verifySerialString(manualSerial);
    setManualSerial('');
  };

  const toggleManualNoteVerify = (note: Banknote) => {
    const norm = normalizeSerialNumber(note.serial_number);
    setVerifiedSerials((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) {
        next.delete(norm);
      } else {
        next.add(norm);
      }
      return next;
    });
  };

  const handleResetSession = () => {
    setVerifiedSerials(new Set());
    setUnknownSerials([]);
    setLastFeedback(null);
    setActiveTab('MISSING');
  };

  const allVerified =
    heldBanknotes.length > 0 && missingNotes.length === 0;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#090d16] text-slate-100 safe-top">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-white leading-none">
              Kiểm Tiền &amp; Đối Chiếu Số Seri
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Quét từng tờ tiền đang cầm để xem có thiếu mất tờ nào không
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetSession}
            className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1 transition"
            title="Làm mới phiên kiểm tiền"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Kiểm lại từ đầu</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-4 space-y-4 pb-24">
          {/* Summary Progress Card */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
                <span className="text-[11px] font-semibold uppercase text-emerald-300">
                  Đã kiểm khớp
                </span>
                <p className="mt-1 text-xl font-extrabold font-mono text-white">
                  {verifiedNotes.length} / {heldBanknotes.length} tờ
                </p>
                <p className="text-xs font-mono text-emerald-300 mt-0.5">
                  {formatTWD(verifiedAmount)} / {formatTWD(totalHeldAmount)}
                </p>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  missingNotes.length === 0
                    ? 'bg-emerald-950/30 border-emerald-500/30'
                    : 'bg-rose-950/40 border-rose-500/30'
                }`}
              >
                <span
                  className={`text-[11px] font-semibold uppercase ${
                    missingNotes.length === 0
                      ? 'text-emerald-300'
                      : 'text-rose-300'
                  }`}
                >
                  {missingNotes.length === 0
                    ? 'Đủ 100% không thiếu'
                    : 'Còn thiếu (Chưa quét)'}
                </span>
                <p className="mt-1 text-xl font-extrabold font-mono text-white">
                  {missingNotes.length} tờ
                </p>
                <p
                  className={`text-xs font-mono mt-0.5 ${
                    missingNotes.length === 0
                      ? 'text-emerald-300'
                      : 'text-rose-300'
                  }`}
                >
                  {formatTWD(missingAmount)}
                </p>
              </div>
            </div>

            {/* All Verified Celebration Banner */}
            {allVerified && (
              <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-400 text-emerald-200 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>
                  Tuyệt vời! Bạn đã kiểm đủ toàn bộ {heldBanknotes.length} tờ
                  tiền đang giữ ({formatTWD(totalHeldAmount)}), không thiếu tờ
                  nào!
                </span>
              </div>
            )}

            {/* Primary Continuous Camera Audit Button */}
            <button
              type="button"
              onClick={() => setIsAuditCameraOpen(true)}
              className="w-full py-4 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-base flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20 transition"
            >
              <Camera className="w-6 h-6 stroke-[2.2]" />
              <span>Mở Camera Quét Kiểm Tiền Liên Tục</span>
            </button>

            {/* Manual Serial Input for quick check */}
            <form onSubmit={handleManualVerifySubmit} className="flex gap-2">
              <input
                type="text"
                value={manualSerial}
                onChange={(e) => setManualSerial(e.target.value.toUpperCase())}
                placeholder="Hoặc nhập số seri để kiểm..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono uppercase text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={!manualSerial.trim()}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold text-white transition"
              >
                Kiểm
              </button>
            </form>

            {/* Last Scan Feedback Alert */}
            {lastFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
                  lastFeedback.type === 'matched'
                    ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
                    : lastFeedback.type === 'already'
                    ? 'bg-sky-950/70 border-sky-500/40 text-sky-200'
                    : 'bg-amber-950/70 border-amber-500/40 text-amber-200'
                }`}
              >
                <span>{lastFeedback.text}</span>
                <button
                  type="button"
                  onClick={() => setLastFeedback(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Unknown serials scanned during audit */}
            {unknownSerials.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <HelpCircle className="w-4 h-4" />
                  <span>
                    Tờ tiền lạ vừa quét (chưa lưu trong hệ thống:{' '}
                    {unknownSerials.length}):
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unknownSerials.map((s) => (
                    <span
                      key={s}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-amber-500/30 text-xs font-mono font-bold text-amber-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabs: Missing vs Verified */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('MISSING')}
              className={`py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeTab === 'MISSING'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Còn thiếu / Chưa quét ({missingNotes.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('VERIFIED')}
              className={`py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                activeTab === 'VERIFIED'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Đã kiểm khớp ({verifiedNotes.length})</span>
            </button>
          </div>

          {/* List of Missing or Verified Banknotes */}
          <div className="space-y-2.5">
            {(activeTab === 'MISSING' ? missingNotes : verifiedNotes).length ===
            0 ? (
              <div className="rounded-2xl bg-slate-900/50 border border-slate-800 p-8 text-center space-y-2">
                <p className="text-sm font-medium text-slate-300">
                  {activeTab === 'MISSING'
                    ? 'Không có tờ tiền nào bị thiếu!'
                    : 'Chưa có tờ tiền nào được quét kiểm trong phiên này.'}
                </p>
              </div>
            ) : (
              (activeTab === 'MISSING' ? missingNotes : verifiedNotes).map(
                (note) => {
                  const denomStyle =
                    DENOMINATION_STYLES[note.denomination] ||
                    DENOMINATION_STYLES[100];
                  const isVerified = verifiedSerials.has(
                    normalizeSerialNumber(note.serial_number)
                  );
                  const timeStr = formatDateTimeVN(note.created_at);

                  return (
                    <div
                      key={note.id}
                      className={`rounded-2xl border p-3.5 flex items-start justify-between gap-3 transition ${
                        isVerified
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-slate-900/90 border-rose-500/30'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border ${denomStyle.badgeBg} ${denomStyle.badgeText} ${denomStyle.border}`}
                          >
                            {note.denomination} TWD
                          </span>

                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                              isVerified
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {isVerified ? '✓ ĐÃ CÓ MẶT' : 'CHƯA THẤY'}
                          </span>

                          {timeStr && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Clock className="w-3 h-3 text-slate-500" />
                              <span>{timeStr}</span>
                            </span>
                          )}
                        </div>

                        <p className="mt-1.5 font-mono text-base font-bold tracking-wider text-white truncate">
                          {note.serial_number}
                        </p>

                        {note.note && (
                          <p className="mt-1 text-xs text-slate-300 flex items-start gap-1.5 break-words">
                            <FileText className="w-3.5 h-3.5 text-emerald-400/80 shrink-0 mt-0.5" />
                            <span>{note.note}</span>
                          </p>
                        )}
                      </div>

                      {/* Actions on Missing / Verified item */}
                      <div className="shrink-0 flex items-center gap-1.5">
                        {note.scan_image && (
                          <button
                            type="button"
                            onClick={() => onViewImage(note)}
                            title="Xem lại ảnh thực tế lúc quét"
                            className="p-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleManualNoteVerify(note)}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center gap-1 transition ${
                            isVerified
                              ? 'bg-slate-800 border-slate-700 text-slate-300'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                          }`}
                          title={
                            isVerified
                              ? 'Bỏ đánh dấu đã kiểm'
                              : 'Đánh dấu thủ công là đã thấy tờ này'
                          }
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isVerified ? 'Bỏ khớp' : 'Đã thấy'}</span>
                        </button>

                        {!isVerified && (
                          <>
                            <button
                              type="button"
                              onClick={() => onMarkSpent(note)}
                              className="py-2 px-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition"
                              title="Tờ này đã tiêu mất rồi -> Chuyển sang ĐÃ TIÊU"
                            >
                              Đã tiêu
                            </button>

                            <button
                              type="button"
                              onClick={() => onDeletePermanent(note)}
                              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 border border-slate-700 text-slate-400 hover:text-rose-300 transition"
                              title="Xóa hẳn tờ này"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }
              )
            )}
          </div>
        </div>
      </div>

      {/* Continuous Camera Scanner for Audit */}
      <CameraScannerModal
        isOpen={isAuditCameraOpen}
        onClose={() => setIsAuditCameraOpen(false)}
        onScanComplete={handleAuditCameraScan}
        continuousMode={true}
        continuousBannerText={`Đã kiểm khớp: ${verifiedNotes.length} / ${heldBanknotes.length} tờ • Còn thiếu: ${missingNotes.length} tờ (${formatTWD(missingAmount)})`}
        continuousSubText={lastFeedback?.text || 'Đưa lần lượt từng tờ tiền vào khung xanh'}
      />
    </div>
  );
}
