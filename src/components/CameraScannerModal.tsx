'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Upload, X, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import { recognizeSerialFromCanvas, OcrScanResult } from '@/lib/ocr';

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

  const handleCaptureVideoFrame = async () => {
    const video = videoRef.current;
    if (!video || !cameraReady || isProcessing) return;

    setIsProcessing(true);
    setOcrProgress(5);

    try {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // Crop central horizontal serial strip (76% width, 24% height) matching the viewfinder reticle
      const cropW = Math.floor(vw * 0.78);
      const cropH = Math.floor(vh * 0.24);
      const cropX = Math.floor((vw - cropW) / 2);
      const cropY = Math.floor((vh - cropH) / 2);

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Không thể khởi tạo khung xử lý ảnh');

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(10, pct));
      });

      stopCamera();
      onScanComplete(result);
    } catch {
      setCameraError('Lỗi nhận diện OCR. Vui lòng thử lại hoặc nhập thủ công.');
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setOcrProgress(5);
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
      const maxDim = 1400;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.floor(img.width * scale));
      canvas.height = Math.max(1, Math.floor(img.height * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context error');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(imageUrl);

      const result = await recognizeSerialFromCanvas(canvas, (pct) => {
        setOcrProgress(Math.max(10, pct));
      });

      stopCamera();
      onScanComplete(result);
    } catch {
      setCameraError('Không thể đọc số seri từ ảnh này. Vui lòng thử ảnh rõ nét hơn.');
      setIsProcessing(false);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-white">
            Quét số seri tờ tiền TWD
          </h2>
        </div>
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

        {/* Serial Number Aiming Reticle */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-sm h-28 rounded-2xl border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.62)] relative flex items-center justify-center">
            {/* Corner brackets */}
            <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-4 border-l-4 border-emerald-300 rounded-tl-xl" />
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-4 border-r-4 border-emerald-300 rounded-tr-xl" />
            <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-4 border-l-4 border-emerald-300 rounded-bl-xl" />
            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-4 border-r-4 border-emerald-300 rounded-br-xl" />

            <div className="text-center px-3">
              <p className="text-xs font-mono tracking-widest uppercase text-emerald-300/90 bg-slate-950/75 px-3 py-1 rounded-full border border-emerald-500/30">
                AA 123456 BB
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs sm:text-sm text-slate-200 font-medium text-center bg-slate-900/80 px-4 py-1.5 rounded-full border border-slate-700/70">
            Đưa dãy số seri trên tờ tiền vào giữa khung xanh
          </p>
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

        {/* OCR Progress Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 z-20">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4 animate-pulse">
              <Sparkles className="w-7 h-7 text-emerald-400 animate-spin" />
            </div>
            <p className="text-base font-semibold text-white mb-1">
              Đang nhận diện số seri (OCR)...
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Tesseract.js đang đọc ký tự trên tờ tiền ({ocrProgress}%)
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

      {/* Bottom Controls */}
      <div className="px-4 py-5 bg-slate-950 border-t border-slate-800/80 safe-bottom">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCaptureVideoFrame}
            disabled={!cameraReady || isProcessing}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition"
          >
            <Camera className="w-5 h-5" />
            <span>Chụp &amp; Quét Số Seri Ngay</span>
          </button>

          <div className="flex items-center gap-2.5">
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
              className="flex-1 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition"
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>Chụp ảnh / Tải ảnh từ máy</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
