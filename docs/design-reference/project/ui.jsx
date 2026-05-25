// ─────────────────────────────────────────────────────────────
// Study Buddy — shared UI atoms
// ─────────────────────────────────────────────────────────────

// Soft star (no emoji) — for streaks, ratings
function SBStar({ size = 18, filled = true, color = 'var(--sun)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path d="M12 2 L14.6 9 L22 9.5 L16.3 14.2 L18.2 21.3 L12 17.3 L5.8 21.3 L7.7 14.2 L2 9.5 L9.4 9 Z"
        fill={filled ? color : 'none'}
        stroke={filled ? color : 'var(--ink-4)'}
        strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Flame for streaks
function SBFlame({ size = 18, color = 'var(--coral)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path d="M12 2 C8 7 6 9 6 13 C6 18 9 22 12 22 C15 22 18 18 18 13 C18 11 17 9.5 16 8 C15 11 14 11 13 9 C12.5 7 12.5 5 12 2 Z"
        fill={color} />
      <path d="M12 11 C10 13 9 14 9 16 C9 18 10 20 12 20 C14 20 15 18 15 16 C15 14.5 14 13 12 11 Z"
        fill="var(--sun)" />
    </svg>
  );
}

// Sound wave dots (loading/thinking)
function SBSparkle({ size = 14, color = 'var(--lavender)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z" fill={color} />
    </svg>
  );
}

// Icon shapes (simple) for subject cards
function SubjectIcon({ kind, size = 28, color = 'white' }) {
  const stroke = { stroke: color, strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const map = {
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
        <path d="M9 3 L9 10 L4 19 C3 21 4 22 6 22 L18 22 C20 22 21 21 20 19 L15 10 L15 3" {...stroke} />
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
        <path d="M3 12 L21 12 M12 3 C15 7 15 17 12 21 M12 3 C9 7 9 17 12 21" {...stroke} />
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
  return map[kind] || null;
}

// Simple bottom-nav icons
function NavIcon({ kind, active, color, mute }) {
  const c = active ? color : mute;
  const s = { stroke: c, strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const fillIfActive = active ? c : 'none';
  const map = {
    home: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <path d="M3 11 L12 3 L21 11 L21 20 C21 21 20 21 19 21 L15 21 L15 14 L9 14 L9 21 L5 21 C4 21 3 21 3 20 Z"
          {...s} fill={fillIfActive} fillOpacity={active ? 0.15 : 0} />
      </svg>
    ),
    library: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <rect x="3" y="5" width="5" height="15" rx="1" {...s} fill={fillIfActive} fillOpacity={active ? 0.15 : 0} />
        <rect x="10" y="5" width="5" height="15" rx="1" {...s} fill={fillIfActive} fillOpacity={active ? 0.15 : 0} />
        <path d="M17 6 L21 7 L19 20 L17 20" {...s} fill={fillIfActive} fillOpacity={active ? 0.15 : 0} />
      </svg>
    ),
    profile: (
      <svg width="26" height="26" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" {...s} fill={fillIfActive} fillOpacity={active ? 0.15 : 0} />
        <path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" {...s} />
      </svg>
    ),
  };
  return map[kind] || null;
}

function BottomNav({ active = 'home', accent = 'var(--coral)' }) {
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'library', label: 'Subjects' },
    { id: 'profile', label: 'Me' },
  ];
  return (
    <div style={{
      borderTop: '1px solid var(--line)',
      background: 'var(--surface)',
      padding: '10px 14px 18px',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'flex-start',
    }}>
      {items.map(it => {
        const isActive = it.id === active;
        return (
          <div key={it.id} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            color: isActive ? accent : 'var(--ink-3)',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11,
          }}>
            <NavIcon kind={it.id} active={isActive} color={accent} mute={'var(--ink-3)'} />
            <span>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Pill button
function SBButton({ children, kind = 'primary', size = 'md', onClick, full = false, style = {} }) {
  const sizeMap = {
    sm: { padding: '8px 14px', fontSize: 13 },
    md: { padding: '12px 20px', fontSize: 15 },
    lg: { padding: '16px 28px', fontSize: 17 },
  };
  const kindMap = {
    primary: { background: 'var(--coral)', color: 'white', boxShadow: '0 4px 0 var(--coral-d)' },
    soft:    { background: 'var(--coral-l)', color: 'var(--coral-d)', boxShadow: 'none' },
    ghost:   { background: 'transparent', color: 'var(--ink-2)', boxShadow: 'inset 0 0 0 1.5px var(--line)' },
    mint:    { background: 'var(--mint)', color: 'white', boxShadow: '0 4px 0 #2FA77F' },
    dark:    { background: 'var(--ink)', color: 'white', boxShadow: '0 4px 0 #0F0907' },
  };
  return (
    <button onClick={onClick} style={{
      border: 'none', cursor: 'pointer',
      borderRadius: 999,
      fontFamily: 'var(--font-body)', fontWeight: 800,
      width: full ? '100%' : undefined,
      ...sizeMap[size], ...kindMap[kind], ...style,
    }}>
      {children}
    </button>
  );
}

// Hint chip — Socratic prompt
function HintChip({ children, icon = null }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 14px',
      background: 'var(--surface)',
      border: '1.5px solid var(--line)',
      borderRadius: 999,
      fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,
      color: 'var(--ink-2)',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 0 rgba(0,0,0,0.04)',
    }}>
      {icon}
      {children}
    </div>
  );
}

// Card surface
function SBCard({ children, color = 'var(--surface)', radius = 24, pad = 16, style = {} }) {
  return (
    <div style={{
      background: color, borderRadius: radius, padding: pad,
      ...style,
    }}>
      {children}
    </div>
  );
}

// Speech bubble — for Pip or transcript lines
function Bubble({ children, from = 'pip', style = {} }) {
  const isPip = from === 'pip';
  return (
    <div style={{
      maxWidth: '78%',
      alignSelf: isPip ? 'flex-start' : 'flex-end',
      background: isPip ? 'var(--surface)' : 'var(--coral)',
      color: isPip ? 'var(--ink)' : 'white',
      padding: '12px 16px',
      borderRadius: 20,
      borderBottomLeftRadius: isPip ? 6 : 20,
      borderBottomRightRadius: isPip ? 20 : 6,
      fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, lineHeight: 1.4,
      boxShadow: '0 2px 0 rgba(0,0,0,0.04)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// Badge for learning style traits
function StyleBadge({ icon, label, score, color = 'var(--lavender)' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px',
      borderRadius: 18,
      background: 'var(--surface)',
      border: `1.5px solid var(--line)`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10,
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{label}</div>
        <div style={{ height: 5, background: 'var(--line)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 99 }} />
        </div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', fontWeight: 700 }}>{score}</div>
    </div>
  );
}

// Section header
function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 4px 8px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)' }}>{children}</div>
      {action && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--coral-d)' }}>{action}</div>}
    </div>
  );
}

Object.assign(window, {
  SBStar, SBFlame, SBSparkle, SubjectIcon, NavIcon, BottomNav,
  SBButton, HintChip, SBCard, Bubble, StyleBadge, SectionTitle,
});
