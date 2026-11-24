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
  ZoomIn,
  Flashlight,
} from 'lucide-react';
import {
  recognizeSerialFromCanvas,
  computeCanvasSharpness,
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
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);

  // Live Auto-Scan & Camera Enhancement Controls
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<1 | 1.6>(1.6);
  const [torchOn, setTorchOn] = useState(false);
  const [sharpnessScore, setSharpnessScore] = useState(0);
  const [liveStatusText, setLiveStatusText] = useState(
    'Đưa dãy số seri vào khung xanh — Tự động nhận ngay khi thấy'
  );
  const [liveDetectedCandidate, setLiveDetectedCandidate] = useState<
    string | null
  >(null);

  const isScanningFrameRef = useRef(false);
  const completedRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setTorchOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCameraReady(false);
    completedRef.current = false;
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

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

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
        'Không thể truy cập camera. Vui lòng cấp quyền camera trên Safari/trình duyệt hoặc nhấn "Tải ảnh" bên dưới.'
      );
    }
  }, [stopCamera]);

  // Toggle hardware flashlight/torch if supported on iPhone/Android
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || typeof track.applyConstraints !== 'function') return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        advanced: [{ torch: next } as any],
      });
      setTorchOn(next);
    } catch {
      // Torch not supported on this device/browser
    }
  };

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
   * Maps the exact on-screen green reticle box (`reticleRef.getBoundingClientRect()`)
   * to the underlying `<video>` pixel coordinates, taking CSS `object-cover` and `zoomLevel`
   * into account so what the user sees inside the green box is 100% what gets cropped!
   */
  const cropExactReticleFromVideo =
    useCallback((): HTMLCanvasElement | null => {
      const video = videoRef.current;
      const reticle = reticleRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return null;

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      const vRect = video.getBoundingClientRect();
      const rRect = reticle?.getBoundingClientRect();

      let cropX = Math.floor(vw * 0.14);
      let cropY = Math.floor(vh * 0.44);
      let cropW = Math.floor(vw * 0.72);
      let cropH = Math.floor(vh * 0.12);

      if (vRect.width > 0 && vRect.height > 0 && rRect && rRect.width > 0) {
        // Compute object-cover scale & offset
        const baseScale = Math.max(vRect.width / vw, vRect.height / vh);
        const effectiveScale = baseScale * zoomLevel;

        const displayedW = vw * effectiveScale;
        const displayedH = vh * effectiveScale;

        const offsetX = (vRect.width - displayedW) / 2;
        const offsetY = (vRect.height - displayedH) / 2;

        const relLeft = rRect.left - vRect.left - offsetX;
        const relTop = rRect.top - vRect.top - offsetY;

        cropX = Math.max(0, Math.floor(relLeft / effectiveScale));
        cropY = Math.max(0, Math.floor(relTop / effectiveScale));
        cropW = Math.min(vw - cropX, Math.floor(rRect.width / effectiveScale));
        cropH = Math.min(vh - cropY, Math.floor(rRect.height / effectiveScale));
      }

      if (cropW < 32 || cropH < 16) return null;

      const canvas = document.createElement('canvas');
      // 460px width is the sweet spot: crisp characters, ~10KB JPEG, <90ms PaddleOCR inference
      const outW = Math.min(460, cropW);
      const outH = Math.max(44, Math.round((cropH / cropW) * outW));
      canvas.width = outW;
      canvas.height = outH;

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
      return canvas;
    }, [zoomLevel]);

  // Hands-free High-Speed Auto-Scan Loop (every 240ms, instant 1-hit lock-in)
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

      const canvas = cropExactReticleFromVideo();
      if (!canvas) return;

      const sharpness = Math.round(computeCanvasSharpness(canvas));
      setSharpnessScore(sharpness);

      // Threshold 8+ allows scanning as soon as text enters the reticle
      if (sharpness < 8) {
        setLiveStatusText('Đưa dãy số seri vào giữa khung xanh...');
        return;
      }

      isScanningFrameRef.current = true;
      setLiveStatusText('Đang đọc số seri bằng AI (PaddleOCR)...');

      try {
        const result = await recognizeSerialFromCanvas(canvas);
        if (completedRef.current) return;

        // Instant 1-hit lock-in as soon as a valid 10-character TWD serial (2L + 6D + 2L) is recognized!
        if (result.isExactTwdFormat && result.serialNumber.length === 10) {
          completedRef.current = true;
          setLiveDetectedCandidate(result.serialNumber);

          if (
            typeof navigator !== 'undefined' &&
            typeof navigator.vibrate === 'function'
          ) {
            navigator.vibrate(50);
          }

          stopCamera();
          onScanComplete(result);
          return;
        }
      } catch {
        // Ignore frame error
      } finally {
        isScanningFrameRef.current = false;
      }
    }, 240);

    return () => clearInterval(interval);
  }, [
    isOpen,
    cameraReady,
    autoScanEnabled,
    isProcessing,
    cropExactReticleFromVideo,
    stopCamera,
    onScanComplete,
  ]);

  // Manual capture fallback button
  const handleManualCapture = async () => {
    if (!cameraReady || isProcessing) return;
    const canvas = cropExactReticleFromVideo();
    if (!canvas) return;

    completedRef.current = true;
    setIsProcessing(true);
    setOcrProgress(20);

    try {
      let retries = 0;
      while (isScanningFrameRef.current && retries < 12) {
        await new Promise((r) => setTimeout(r, 60));
        retries++;
      }

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(20, pct));
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
    setOcrProgress(15);
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
      const maxDim = 1000;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context error');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(imageUrl);

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(20, pct));
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

  const isSharp = sharpnessScore >= 8;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm sm:text-base font-semibold text-white">
            Quét AI Số Seri (PaddleOCR)
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 1x / 1.6x Macro Focus Zoom Toggle */}
          <button
            type="button"
            onClick={() => setZoomLevel((z) => (z === 1 ? 1.6 : 1))}
            className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-slate-800 border border-slate-700 text-emerald-300 flex items-center gap-1"
            title="Phóng to 1.6x để giữ điện thoại cách tờ tiền 15-20cm giúp camera iPhone lấy nét căng nhất"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span>{zoomLevel}x</span>
          </button>

          {/* Flashlight / Torch Toggle */}
          <button
            type="button"
            onClick={toggleTorch}
            className={`p-1.5 rounded-full border transition ${
              torchOn
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Bật đèn Flash chiếu sáng tờ tiền"
          >
            <Flashlight className="w-4 h-4" />
          </button>

          {/* Auto-Scan Toggle */}
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
            <span>{autoScanEnabled ? 'Tự động' : 'Thủ công'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-full bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 transition"
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
          style={{
            transform: zoomLevel > 1 ? `scale(${zoomLevel})` : undefined,
            transformOrigin: 'center center',
          }}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            cameraReady ? 'opacity-100' : 'opacity-20'
          }`}
        />

        {/* Exact-Mapped Single-Line Serial Number Aiming Reticle */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
          <div
            ref={reticleRef}
            className={`w-full max-w-[330px] h-[72px] rounded-2xl border-2 transition-colors duration-150 shadow-[0_0_0_9999px_rgba(2,6,23,0.72)] relative flex items-center justify-center ${
              liveDetectedCandidate
                ? 'border-emerald-400 bg-emerald-500/15'
                : isSharp
                ? 'border-emerald-400'
                : 'border-amber-400/75'
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
                <p className="text-xs font-mono tracking-widest uppercase text-emerald-300/70 bg-slate-950/65 px-3 py-1 rounded-full border border-emerald-500/25">
                  TY 328954 HR
                </p>
              )}
            </div>
          </div>

          {/* Live Sharpness & Auto-Scan Status Pill */}
          <div className="mt-4 flex flex-col items-center gap-1">
            <p
              className={`text-xs sm:text-sm font-medium text-center px-4 py-1.5 rounded-full border transition ${
                isSharp
                  ? 'bg-emerald-950/85 text-emerald-200 border-emerald-500/40'
                  : 'bg-slate-900/85 text-amber-200 border-amber-500/30'
              }`}
            >
              {liveStatusText}
            </p>
            <span className="text-[11px] text-slate-300/90 bg-slate-950/70 px-3 py-0.5 rounded-full">
              Mẹo: Giữ điện thoại cách tờ tiền 15–20cm để camera iPhone lấy nét nhanh nhất
            </span>
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
              Đang đọc số seri bằng AI (PaddleOCR)...
            </p>
            <div className="w-56 h-2 bg-slate-800 rounded-full overflow-hidden mt-3">
              <div
                className="h-full bg-emerald-500 transition-all duration-200 rounded-full"
                style={{ width: `${Math.min(100, Math.max(15, ocrProgress))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
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
