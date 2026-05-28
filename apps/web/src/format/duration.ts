export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

export function formatMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
}
