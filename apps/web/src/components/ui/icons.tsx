import type { SubjectKind } from '@study-buddy/shared';

export function Star({
  size = 18,
  filled = true,
  color = 'var(--color-sun)',
}: {
  size?: number;
  filled?: boolean;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path
        d="M12 2 L14.6 9 L22 9.5 L16.3 14.2 L18.2 21.3 L12 17.3 L5.8 21.3 L7.7 14.2 L2 9.5 L9.4 9 Z"
        fill={filled ? color : 'none'}
        stroke={filled ? color : 'var(--color-ink-4)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Flame({
  size = 18,
  color = 'var(--color-coral)',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path
        d="M12 2 C8 7 6 9 6 13 C6 18 9 22 12 22 C15 22 18 18 18 13 C18 11 17 9.5 16 8 C15 11 14 11 13 9 C12.5 7 12.5 5 12 2 Z"
        fill={color}
      />
      <path
        d="M12 11 C10 13 9 14 9 16 C9 18 10 20 12 20 C14 20 15 18 15 16 C15 14.5 14 13 12 11 Z"
        fill="var(--color-sun)"
      />
    </svg>
  );
}

export function Sparkle({
  size = 14,
  color = 'var(--color-lavender)',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z"
        fill={color}
      />
    </svg>
  );
}

export function SubjectIcon({
  kind,
  size = 28,
  color = 'white',
}: {
  kind: SubjectKind;
  size?: number;
  color?: string;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 2.2,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const map: Record<SubjectKind, JSX.Element> = {
    math: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M5 7 L11 7 M8 4 L8 10" {...stroke} />
        <path d="M14 5 L20 11 M14 11 L20 5" {...stroke} />
        <circle cx="8" cy="17" r="2.5" {...stroke} />
        <path d="M14 16 L20 16 M14 19 L20 19" {...stroke} />
      </svg>
    ),
    reading: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M3 5 L11 7 L11 20 L3 18 Z" {...stroke} />
        <path d="M21 5 L13 7 L13 20 L21 18 Z" {...stroke} />
      </svg>
    ),
    science: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M9 3 L9 10 L4 19 C3 21 4 22 6 22 L18 22 C20 22 21 21 20 19 L15 10 L15 3"
          {...stroke}
        />
        <path d="M9 3 L15 3" {...stroke} />
        <circle cx="11" cy="16" r="1" fill={color} />
        <circle cx="14" cy="18" r="1" fill={color} />
      </svg>
    ),
    writing: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M4 20 L7 13 L17 3 L21 7 L11 17 L4 20 Z" {...stroke} />
        <path d="M14 6 L18 10" {...stroke} />
      </svg>
    ),
    spanish: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" {...stroke} />
        <path
          d="M3 12 L21 12 M12 3 C15 7 15 17 12 21 M12 3 C9 7 9 17 12 21"
          {...stroke}
        />
      </svg>
    ),
    social: (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="9" cy="9" r="3" {...stroke} />
        <circle cx="17" cy="11" r="2.2" {...stroke} />
        <path d="M3 20 C3 16 6 14 9 14 C12 14 15 16 15 20" {...stroke} />
        <path d="M14 20 C14 17.5 16 16 17 16 C19 16 21 17.5 21 20" {...stroke} />
      </svg>
    ),
  };

  return map[kind] ?? null;
}

export function NavIcon({
  kind,
  active,
  color,
  mute,
}: {
  kind: 'home' | 'library' | 'profile';
  active: boolean;
  color: string;
  mute: string;
}) {
  const c = active ? color : mute;
  const s = {
    stroke: c,
    strokeWidth: 2,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const fillIfActive = active ? c : 'none';

  const map: Record<'home' | 'library' | 'profile', JSX.Element> = {
    home: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <path
          d="M3 11 L12 3 L21 11 L21 20 C21 21 20 21 19 21 L15 21 L15 14 L9 14 L9 21 L5 21 C4 21 3 21 3 20 Z"
          {...s}
          fill={fillIfActive}
          fillOpacity={active ? 0.15 : 0}
        />
      </svg>
    ),
    library: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <rect
          x="3"
          y="5"
          width="5"
          height="15"
          rx="1"
          {...s}
          fill={fillIfActive}
          fillOpacity={active ? 0.15 : 0}
        />
        <rect
          x="10"
          y="5"
          width="5"
          height="15"
          rx="1"
          {...s}
          fill={fillIfActive}
          fillOpacity={active ? 0.15 : 0}
        />
        <path
          d="M17 6 L21 7 L19 20 L17 20"
          {...s}
          fill={fillIfActive}
          fillOpacity={active ? 0.15 : 0}
        />
      </svg>
    ),
    profile: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <circle
          cx="12"
          cy="8"
          r="4"
          {...s}
          fill={fillIfActive}
          fillOpacity={active ? 0.15 : 0}
        />
        <path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" {...s} />
      </svg>
    ),
  };

  return map[kind] ?? null;
}
