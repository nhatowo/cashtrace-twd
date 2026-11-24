'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Upload,
  X,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import {
  recognizeSerialFromCanvas,
  computeCanvasSharpness,
  prewarmOcrWorker,
  OcrScanResult,
} from '@/lib/ocr';

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (result: OcrScanResult) => void;
}

export default function CameraScannerModal({
  isOpen,
  onClose,
  onScanComplete,
}: CameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);

  // Live Auto-Scan state
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [sharpnessScore, setSharpnessScore] = useState(0);
  const [liveStatusText, setLiveStatusText] = useState(
    'Đưa dãy số seri vào khung — Tự động nhận diện khi đủ nét'
  );
  const [liveDetectedCandidate, setLiveDetectedCandidate] = useState<
    string | null
  >(null);

  const isScanningFrameRef = useRef(false);
  const lastCandidateRef = useRef<string>('');
  const completedRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    completedRef.current = false;
    lastCandidateRef.current = '';
    setLiveDetectedCandidate(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError(
        'Trình duyệt không hỗ trợ mở camera trực tiếp. Bạn có thể chụp ảnh hoặc tải ảnh lên bên dưới.'
      );
      return;
    }

    try {
      stopCamera();
      prewarmOcrWorker();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // Attempt to enable continuous autofocus on mobile camera track if supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        try {
          await videoTrack.applyConstraints({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            advanced: [{ focusMode: 'continuous' } as any],
          });
        } catch {
          // Ignore if browser doesn't expose focusMode constraint
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraError(
        'Không thể truy cập camera. Vui lòng cấp quyền camera trên Safari/trình duyệt hoặc nhấn "Chụp / Tải ảnh" bên dưới.'
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setIsProcessing(false);
      setOcrProgress(0);
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  /**
   * Crops the tight horizontal serial number strip from the current video frame.
   * Height is 12% of video height so background characters above/below the serial line are excluded.
   */
  const cropSerialStripFromVideo = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const cropW = Math.floor(vw * 0.72);
    const cropH = Math.floor(vh * 0.12);
    const cropX = Math.floor((vw - cropW) / 2);
    const cropY = Math.floor((vh - cropH) / 2);

    const canvas = document.createElement('canvas');
    // Normalize width to max 560px for ultra-fast real-time OCR
    const outW = Math.min(560, cropW);
    const outH = Math.max(48, Math.round((cropH / cropW) * outW));
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
    return canvas;
  }, []);

  // Hands-free Live Auto-Scan Loop when frame is sharp enough
  useEffect(() => {
    if (!isOpen || !cameraReady || !autoScanEnabled || isProcessing) return;

    const interval = setInterval(async () => {
      if (
        isScanningFrameRef.current ||
        completedRef.current ||
        isProcessing
      ) {
        return;
      }

      const canvas = cropSerialStripFromVideo();
      if (!canvas) return;

      const sharpness = Math.round(computeCanvasSharpness(canvas));
      setSharpnessScore(sharpness);

      // Threshold 11+ indicates clear character edges inside the reticle
      if (sharpness < 11) {
        setLiveStatusText('Giữ cố định tờ tiền cho đủ nét...');
        return;
      }

      isScanningFrameRef.current = true;
      setLiveStatusText('Khung hình đã nét — Đang tự động đọc số seri...');

      try {
        const result = await recognizeSerialFromCanvas(canvas);
        if (completedRef.current) return;

        if (result.isExactTwdFormat && result.serialNumber.length === 10) {
          setLiveDetectedCandidate(result.serialNumber);

          // Confirm immediately if high confidence (>= 70%) or matched 2 times in a row
          if (
            result.confidence >= 70 ||
            lastCandidateRef.current === result.serialNumber
          ) {
            completedRef.current = true;
            if (
              typeof navigator !== 'undefined' &&
              typeof navigator.vibrate === 'function'
            ) {
              navigator.vibrate(60);
            }
            stopCamera();
            onScanComplete(result);
            return;
          }

          lastCandidateRef.current = result.serialNumber;
          setLiveStatusText(
            `Đang xác nhận số seri: ${result.serialNumber}...`
          );
        } else if (result.serialNumber.length >= 6) {
          setLiveStatusText(
            'Đưa sát dãy 10 ký tự (VD: TY328954HR) vào chính giữa khung...'
          );
        }
      } catch {
        // Ignore busy frame
      } finally {
        isScanningFrameRef.current = false;
      }
    }, 420);

    return () => clearInterval(interval);
  }, [
    isOpen,
    cameraReady,
    autoScanEnabled,
    isProcessing,
    cropSerialStripFromVideo,
    stopCamera,
    onScanComplete,
  ]);

  // Manual capture fallback button
  const handleManualCapture = async () => {
    if (!cameraReady || isProcessing) return;
    const canvas = cropSerialStripFromVideo();
    if (!canvas) return;

    completedRef.current = true;
    setIsProcessing(true);
    setOcrProgress(15);

    try {
      // Wait briefly if a background auto-scan frame is finishing
      let retries = 0;
      while (isScanningFrameRef.current && retries < 10) {
        await new Promise((r) => setTimeout(r, 80));
        retries++;
      }

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(15, pct));
      });

      stopCamera();
      onScanComplete(result);
    } catch {
      completedRef.current = false;
      setCameraError('Lỗi nhận diện OCR. Vui lòng thử lại hoặc nhập thủ công.');
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    completedRef.current = true;
    setIsProcessing(true);
    setOcrProgress(10);
    setCameraError(null);

    try {
      const imageUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = imageUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Không thể đọc file ảnh'));
      });

      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context error');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(imageUrl);

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(15, pct));
      });

      stopCamera();
      onScanComplete(result);
    } catch {
      completedRef.current = false;
      setCameraError(
        'Không thể đọc số seri từ ảnh này. Vui lòng thử ảnh rõ nét hơn.'
      );
      setIsProcessing(false);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  const isSharp = sharpnessScore >= 11;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">
            Quét tự động số seri TWD
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoScanEnabled((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 border transition ${
              autoScanEnabled
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Tự động: {autoScanEnabled ? 'BẬT' : 'TẮT'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 rounded-full bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 transition"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera Viewport */}
      <div className="relative flex-1 flex flex-col items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            cameraReady ? 'opacity-100' : 'opacity-20'
          }`}
        />

        {/* Sleek Single-Line Serial Number Aiming Reticle */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
          <div
            className={`w-full max-w-sm h-20 rounded-2xl border-2 transition-colors duration-200 shadow-[0_0_0_9999px_rgba(2,6,23,0.68)] relative flex items-center justify-center ${
              liveDetectedCandidate
                ? 'border-emerald-400 bg-emerald-500/10'
                : isSharp
                ? 'border-emerald-400/90'
                : 'border-amber-400/70'
            }`}
          >
            {/* Corner brackets */}
            <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-4 border-l-4 border-emerald-300 rounded-tl-xl" />
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-4 border-r-4 border-emerald-300 rounded-tr-xl" />
            <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-4 border-l-4 border-emerald-300 rounded-bl-xl" />
            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-4 border-r-4 border-emerald-300 rounded-br-xl" />

            {/* Scanning laser line animation */}
            {autoScanEnabled && cameraReady && (
              <div className="absolute inset-x-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent animate-pulse" />
            )}

            <div className="text-center px-3">
              {liveDetectedCandidate ? (
                <p className="text-sm font-mono font-bold tracking-widest uppercase text-emerald-200 bg-emerald-950/90 px-3.5 py-1 rounded-full border border-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{liveDetectedCandidate}</span>
                </p>
              ) : (
                <p className="text-xs font-mono tracking-widest uppercase text-emerald-300/75 bg-slate-950/70 px-3 py-1 rounded-full border border-emerald-500/25">
                  TY 328954 HR
                </p>
              )}
            </div>
          </div>

          {/* Live Sharpness & Auto-Scan Status Pill */}
          <div className="mt-4 flex flex-col items-center gap-1.5">
            <p
              className={`text-xs sm:text-sm font-medium text-center px-4 py-1.5 rounded-full border transition ${
                isSharp
                  ? 'bg-emerald-950/85 text-emerald-200 border-emerald-500/40'
                  : 'bg-slate-900/85 text-amber-200 border-amber-500/30'
              }`}
            >
              {liveStatusText}
            </p>
            {cameraReady && (
              <span className="text-[11px] text-slate-400 font-mono">
                Độ nét khung hình: {sharpnessScore}{' '}
                {isSharp ? '✓ Đủ nét' : '(Đưa gần/giữ chắc tay)'}
              </span>
            )}
          </div>
        </div>

        {/* Camera Error Banner */}
        {cameraError && (
          <div className="absolute top-4 inset-x-4 max-w-md mx-auto bg-rose-950/90 border border-rose-500/40 text-rose-200 px-4 py-3 rounded-xl text-xs sm:text-sm flex items-start gap-2.5 shadow-lg">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>{cameraError}</p>
              <button
                type="button"
                onClick={startCamera}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Thử mở lại Camera
              </button>
            </div>
          </div>
        )}

        {/* Manual OCR Progress Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 z-20">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4 animate-pulse">
              <Sparkles className="w-7 h-7 text-emerald-400 animate-spin" />
            </div>
            <p className="text-base font-semibold text-white mb-1">
              Đang xử lý số seri (OCR)...
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Đang lọc mực đỏ/đen và đọc ký tự ({ocrProgress}%)
            </p>
            <div className="w-56 h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-200 rounded-full"
                style={{ width: `${Math.min(100, Math.max(10, ocrProgress))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls (Manual override & File upload fallback) */}
      <div className="px-4 py-4 bg-slate-950 border-t border-slate-800/80 safe-bottom">
        <div className="max-w-md mx-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleManualCapture}
            disabled={!cameraReady || isProcessing}
            className="flex-1 py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition"
          >
            <Camera className="w-4 h-4" />
            <span>Chụp thủ công ngay</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Tải ảnh</span>
          </button>
        </div>
      </div>
    </div>
  );
}
