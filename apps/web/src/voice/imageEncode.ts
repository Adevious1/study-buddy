/** Scale (w,h) so the longest edge ≤ maxEdge, preserving aspect ratio. */
export function computeTargetSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Draw a video frame to a canvas, downscale to ≤maxEdge, and return base64 JPEG
 * (no data-URL prefix). Gemini tokenizes images at ~768px tiles, so 1024px/q0.85
 * is plenty — larger only costs tokens.
 */
export function captureJpegFromVideo(
  video: HTMLVideoElement,
  maxEdge = 1024,
  quality = 0.85,
): string {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error('camera not ready');
  }
  const { w, h } = computeTargetSize(video.videoWidth, video.videoHeight, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.split(',')[1] ?? '';
}
