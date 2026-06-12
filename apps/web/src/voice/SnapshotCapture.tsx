import { useEffect, useRef, useState } from 'react';
import { captureJpegFromVideo } from './imageEncode';

interface Props {
  onCapture: (base64Jpeg: string) => void;
  onClose: () => void;
}

/**
 * Full-screen camera overlay: live preview → freeze-frame → confirm.
 * The camera stream is opened on mount and stopped on unmount (privacy parity
 * with the mic). The child always taps to capture; nothing is sent until they
 * confirm. The camera is optional — a denied permission shows a message and the
 * voice session keeps going.
 */
export function SnapshotCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null); // base64 JPEG once captured
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function takePhoto() {
    if (!videoRef.current) return;
    try {
      setFrozen(captureJpegFromVideo(videoRef.current));
    } catch {
      // camera not ready yet — ignore the tap, keep showing live preview
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-ink/95">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="font-display font-extrabold text-[16px] text-white">Show Pip</div>
        <button
          type="button"
          aria-label="Close camera"
          className="w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer border-0"
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-5 min-h-0">
        {denied ? (
          <div className="text-center text-white/90 font-body font-semibold text-[15px] px-6">
            Pip needs camera permission to see your work. You can still keep talking!
          </div>
        ) : frozen ? (
          <img
            src={`data:image/jpeg;base64,${frozen}`}
            alt="Captured preview"
            className="max-h-full max-w-full rounded-[18px] object-contain"
          />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-full max-w-full rounded-[18px] object-contain"
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 px-6 py-6">
        {frozen ? (
          <>
            <button
              type="button"
              className="px-6 py-3 rounded-full bg-white/15 text-white font-display font-bold text-[15px] cursor-pointer border-0"
              onClick={() => setFrozen(null)}
            >
              Retake
            </button>
            <button
              type="button"
              className="px-6 py-3 rounded-full bg-coral text-white font-display font-extrabold text-[15px] cursor-pointer border-0"
              style={{ boxShadow: '0 4px 0 var(--color-coral-d)' }}
              onClick={() => onCapture(frozen)}
            >
              Send to Pip
            </button>
          </>
        ) : !denied ? (
          <button
            type="button"
            aria-label="Take photo"
            className="w-[72px] h-[72px] rounded-full bg-white cursor-pointer border-[5px] border-white/40"
            onClick={takePhoto}
          />
        ) : null}
      </div>
    </div>
  );
}
