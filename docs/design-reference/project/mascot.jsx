// ─────────────────────────────────────────────────────────────
// Pip — the Study Buddy mascot
// A friendly soft blob with eyes. Reacts to voice with simple
// CSS animations driven by `state` prop.
// states: 'idle' | 'listen' | 'speak' | 'cheer' | 'think'
// ─────────────────────────────────────────────────────────────

function Pip({
  size = 160,
  state = 'idle',
  color = 'var(--coral)',
  shadow = true,
  expression = 'happy', // 'happy' | 'curious' | 'wink' | 'star'
}) {
  const animations = {
    idle:   'pip-breathe 3.6s ease-in-out infinite',
    listen: 'pip-listen 1.1s ease-in-out infinite',
    speak:  'pip-speak 0.45s ease-in-out infinite',
    cheer:  'pip-listen 0.7s ease-in-out infinite',
    think:  'pip-breathe 2.2s ease-in-out infinite',
  };

  // Slightly different blob path per state for visual variety
  const blobPath = "M50,5 C72,5 92,17 96,40 C100,63 92,84 72,93 C52,102 28,98 14,82 C0,66 -2,40 12,22 C23,8 35,5 50,5 Z";

  // Eye position offsets per expression
  const eye = expression === 'curious'
    ? { y: 38, ry: 9 }
    : expression === 'wink'
      ? { y: 42, ry: 7 }
      : { y: 42, ry: 8 };

  const blink = state !== 'speak' && state !== 'cheer';

  return (
    <div style={{
      width: size, height: size,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: size, height: size,
        animation: animations[state] || animations.idle,
        transformOrigin: 'center center',
        filter: shadow ? `drop-shadow(0 ${size*0.06}px ${size*0.12}px rgba(229,97,74,0.28))` : 'none',
      }}>
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <defs>
            <radialGradient id={`pip-grad-${color.replace(/[^a-z]/gi,'')}`} cx="35%" cy="30%" r="80%">
              <stop offset="0%"  stopColor="white" stopOpacity="0.55" />
              <stop offset="40%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* body */}
          <path d={blobPath} fill={color} />
          {/* sheen */}
          <path d={blobPath} fill={`url(#pip-grad-${color.replace(/[^a-z]/gi,'')})`} />

          {/* cheeks */}
          <ellipse cx="22" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />
          <ellipse cx="78" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />

          {/* eyes */}
          <g style={{
            transformOrigin: '35px 42px',
            animation: blink ? 'pip-blink 4.8s ease-in-out infinite' : 'none',
          }}>
            <ellipse cx="35" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
            <circle cx="36.4" cy={eye.y - 2.2} r="1.6" fill="white" />
          </g>
          <g style={{
            transformOrigin: '65px 42px',
            animation: blink ? 'pip-blink 4.8s ease-in-out infinite' : 'none',
            animationDelay: '0.1s',
          }}>
            {expression === 'wink' ? (
              <path d="M60 42 Q65 39 70 42" stroke="#2A1F18" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            ) : (
              <>
                <ellipse cx="65" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
                <circle cx="66.4" cy={eye.y - 2.2} r="1.6" fill="white" />
              </>
            )}
          </g>

          {/* mouth */}
          {state === 'speak' ? (
            <ellipse cx="50" cy="68" rx="7" ry="5" fill="#2A1F18" />
          ) : state === 'cheer' ? (
            <path d="M40 64 Q50 78 60 64" stroke="#2A1F18" strokeWidth="3" fill="#2A1F18" strokeLinejoin="round" />
          ) : state === 'think' ? (
            <path d="M44 68 L56 68" stroke="#2A1F18" strokeWidth="3" strokeLinecap="round" />
          ) : (
            <path d="M42 64 Q50 72 58 64" stroke="#2A1F18" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          )}

          {/* tiny tongue when speaking */}
          {state === 'speak' && (
            <ellipse cx="50" cy="71" rx="3.5" ry="2" fill="#FF6688" />
          )}
        </svg>
      </div>

      {/* listening rings */}
      {state === 'listen' && (
        <>
          <Ring size={size} delay={0} color={color} />
          <Ring size={size} delay={0.7} color={color} />
          <Ring size={size} delay={1.4} color={color} />
        </>
      )}
    </div>
  );
}

function Ring({ size, delay, color }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      borderRadius: '50%',
      border: `2px solid ${color}`,
      opacity: 0,
      animation: `ring-pulse 2.2s ease-out ${delay}s infinite`,
      pointerEvents: 'none',
    }} />
  );
}

// Voice waveform — small bars that bob (for keyboard/transcript area)
function Waveform({ active = true, color = 'var(--coral)', bars = 5, height = 22 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} style={{
          width: 3, height: '100%', borderRadius: 2, background: color,
          transformOrigin: 'center',
          animation: active ? `wave-bar ${0.6 + (i % 3) * 0.15}s ease-in-out ${i * 0.08}s infinite` : 'none',
          opacity: active ? 1 : 0.4,
        }} />
      ))}
    </div>
  );
}

Object.assign(window, { Pip, Waveform });
