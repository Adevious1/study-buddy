import { useId } from 'react';

export type PipState = 'idle' | 'listen' | 'speak' | 'cheer' | 'think';
export type PipExpression = 'happy' | 'curious' | 'wink' | 'star';

const ANIM: Record<PipState, string> = {
  idle: 'animate-pip-breathe',
  listen: 'animate-pip-listen',
  speak: 'animate-pip-speak',
  cheer: 'animate-pip-listen',
  think: 'animate-pip-breathe',
};

const BLOB =
  'M50,5 C72,5 92,17 96,40 C100,63 92,84 72,93 C52,102 28,98 14,82 C0,66 -2,40 12,22 C23,8 35,5 50,5 Z';

export interface PipProps {
  size?: number;
  state?: PipState;
  color?: string;       // CSS color (hex or var). default coral token.
  shadow?: boolean;
  expression?: PipExpression;
}

export function Pip({
  size = 160,
  state = 'idle',
  color = 'var(--color-coral)',
  shadow = true,
  expression = 'happy',
}: PipProps) {
  const gid = useId();
  const eye =
    expression === 'curious' ? { y: 38, ry: 9 }
    : expression === 'wink' ? { y: 42, ry: 7 }
    : { y: 42, ry: 8 };
  const blink = state !== 'speak' && state !== 'cheer';

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className={ANIM[state]}
        style={{
          width: size,
          height: size,
          transformOrigin: 'center center',
          filter: shadow
            ? `drop-shadow(0 ${size * 0.06}px ${size * 0.12}px rgba(229,97,74,0.28))`
            : 'none',
        }}
      >
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <defs>
            <radialGradient id={gid} cx="35%" cy="30%" r="80%">
              <stop offset="0%" stopColor="white" stopOpacity="0.55" />
              <stop offset="40%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d={BLOB} fill={color} />
          <path d={BLOB} fill={`url(#${gid})`} />
          <ellipse cx="22" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />
          <ellipse cx="78" cy="58" rx="7" ry="4.5" fill="#FF4D7E" opacity="0.18" />

          <g
            style={{ transformOrigin: '35px 42px' }}
            className={blink ? 'animate-pip-blink' : undefined}
          >
            <ellipse cx="35" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
            <circle cx="36.4" cy={eye.y - 2.2} r="1.6" fill="white" />
          </g>
          <g
            style={{ transformOrigin: '65px 42px', animationDelay: '0.1s' }}
            className={blink ? 'animate-pip-blink' : undefined}
          >
            {expression === 'wink' ? (
              <path d="M60 42 Q65 39 70 42" stroke="#2A1F18" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            ) : (
              <>
                <ellipse cx="65" cy={eye.y} rx="5" ry={eye.ry} fill="#2A1F18" />
                <circle cx="66.4" cy={eye.y - 2.2} r="1.6" fill="white" />
              </>
            )}
          </g>

          {state === 'speak' ? (
            <ellipse cx="50" cy="68" rx="7" ry="5" fill="#2A1F18" />
          ) : state === 'cheer' ? (
            <path d="M40 64 Q50 78 60 64" stroke="#2A1F18" strokeWidth="3" fill="#2A1F18" strokeLinejoin="round" />
          ) : state === 'think' ? (
            <path d="M44 68 L56 68" stroke="#2A1F18" strokeWidth="3" strokeLinecap="round" />
          ) : (
            <path d="M42 64 Q50 72 58 64" stroke="#2A1F18" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          )}
          {state === 'speak' && <ellipse cx="50" cy="71" rx="3.5" ry="2" fill="#FF6688" />}
        </svg>
      </div>

      {state === 'listen' && (
        <>
          <Ring delay={0} color={color} />
          <Ring delay={0.7} color={color} />
          <Ring delay={1.4} color={color} />
        </>
      )}
    </div>
  );
}

function Ring({ delay, color }: { delay: number; color: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-full animate-ring-pulse"
      style={{ border: `2px solid ${color}`, opacity: 0, animationDelay: `${delay}s` }}
    />
  );
}
