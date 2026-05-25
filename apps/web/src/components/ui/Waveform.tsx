export function Waveform({
  active = true,
  color = 'var(--color-coral)',
  bars = 5,
  height = 22,
}: {
  active?: boolean;
  color?: string;
  bars?: number;
  height?: number;
}) {
  return (
    <div className="flex items-center gap-[3px]" style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-[3px] h-full rounded-[2px]"
          style={{
            background: color,
            transformOrigin: 'center',
            animationName: active ? 'wave-bar' : 'none',
            animationDuration: `${0.6 + (i % 3) * 0.15}s`,
            animationTimingFunction: 'ease-in-out',
            animationDelay: `${i * 0.08}s`,
            animationIterationCount: 'infinite',
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  );
}
