import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SubjectKind } from '@study-buddy/shared';
import { Pip } from '../../components/Pip';
import { Waveform } from '../../components/ui/Waveform';
import { Bubble } from '../../components/ui/Bubble';
import { ErrorState } from '../../components/atoms/ErrorState';
import { usePipColor } from '../../state/PipColorContext';
import { useVoiceSession } from '../../voice/useVoiceSession';
import { SnapshotCapture } from '../../voice/SnapshotCapture';
import { subjectLabel } from '../../theme/subjectTheme';

// ─── Local atoms ───────────────────────────────────────────────

function ControlBtn({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-[6px] cursor-pointer bg-transparent border-0 p-0"
      onClick={onClick}
    >
      <div
        className={`w-14 h-14 rounded-full bg-surface flex items-center justify-center shadow-[0_2px_0_rgba(0,0,0,0.04)] ${
          danger ? 'border-[1.5px] border-coral-l' : 'border-[1.5px] border-line'
        }`}
      >
        {icon}
      </div>
      <div
        className={`font-body font-bold text-[11px] uppercase tracking-[0.4px] ${
          danger ? 'text-coral-d' : 'text-ink-3'
        }`}
      >
        {label}
      </div>
    </button>
  );
}

function BigMic({
  accent,
  active,
  onClick,
}: {
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Toggle microphone"
      className="relative cursor-pointer block bg-transparent border-0 p-0"
      style={{ width: 96, height: 96 }}
      onClick={onClick}
    >
      {/* Pulse rings — only when active */}
      {active && (
        <>
          {[0, 0.6, 1.2].map((d, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-0 rounded-full animate-ring-pulse"
              style={{ border: `2px solid ${accent}`, opacity: 0, animationDelay: `${d}s` }}
            />
          ))}
        </>
      )}
      <div
        className="relative w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: accent,
          boxShadow: `0 6px 0 var(--color-coral-d), 0 12px 24px rgba(229,97,74,0.35)`,
        }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="3" width="6" height="12" rx="3" fill="white" />
          <path
            d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </button>
  );
}

// ─── Voice Route ───────────────────────────────────────────────

interface VoiceNavState {
  subjectKind?: SubjectKind;
  topic?: string;
  title?: string;
  chooseSubject?: boolean;
}

const SUBJECT_CHOICES: { kind: SubjectKind; topic: string }[] = [
  { kind: 'math', topic: 'Anything in math' },
  { kind: 'reading', topic: 'Reading together' },
  { kind: 'science', topic: 'Science questions' },
  { kind: 'writing', topic: 'Writing help' },
];

export function VoiceRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pipColorValue } = usePipColor();
  const nav = (location.state ?? {}) as VoiceNavState;

  const { state, start, end, mute, unmute, sendSnapshot, consumeCameraOffer } = useVoiceSession();
  const [muted, setMuted] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [picked, setPicked] = useState<{ subjectKind: SubjectKind; topic: string; title: string } | null>(
    nav.subjectKind
      ? { subjectKind: nav.subjectKind, topic: nav.topic ?? '', title: nav.title ?? subjectLabel(nav.subjectKind) }
      : null,
  );

  useEffect(() => {
    if (picked && state.status === 'idle') void start(picked);
  }, [picked, state.status, start]);

  // Track whether the session ever actually connected.
  const wentLiveRef = useRef(false);
  useEffect(() => {
    if (state.status === 'live') wentLiveRef.current = true;
  }, [state.status]);

  // Keep the transcript pinned to the newest turn as it grows.
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.turns]);

  // When a session that truly went live ends cleanly, the recap is now written —
  // take the child to it. A session that never connected returns Home instead.
  useEffect(() => {
    if (state.status !== 'ended' || state.error) return;
    navigate(wentLiveRef.current ? '/app/recap' : '/app');
  }, [state.status, state.error, navigate]);

  const accent = 'var(--color-coral)';
  const pipState = state.status === 'live' ? 'listen' : state.status === 'connecting' ? 'think' : 'idle';
  const subjectTitle = useMemo(() => picked?.title ?? 'Talk with Pip', [picked]);
  // Once there are messages, switch to the compact layout (small Pip up top,
  // transcript fills the rest) so long turns are readable instead of clipped.
  const turns = state.turns;
  const hasTurns = turns.length > 0;

  if (state.error) {
    return (
      <ErrorState
        title={state.error === 'mic-denied' ? 'Pip needs your microphone' : 'Pip had trouble'}
        onRetry={() => navigate('/app')}
      />
    );
  }

  if (!picked && nav.chooseSubject) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-bg px-8">
        <Pip size={120} state="idle" color={pipColorValue} expression="happy" />
        <div className="font-display font-extrabold text-[22px] text-ink">What should we work on?</div>
        <div className="grid grid-cols-2 gap-3">
          {SUBJECT_CHOICES.map((c) => (
            <button
              key={c.kind}
              className="rounded-[18px] border-[1.5px] border-line bg-surface px-5 py-4 font-display font-bold text-ink"
              onClick={() => setPicked({ subjectKind: c.kind, topic: c.topic, title: subjectLabel(c.kind) })}
            >
              {subjectLabel(c.kind)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (state.status === 'ending') {
    // Only a session that truly went live has a recap being written. A cancel
    // during "Connecting…" ends quickly and routes Home, so show a quiet
    // placeholder rather than a misleading "writing your recap" for that case.
    return wentLiveRef.current ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg px-8 text-center">
        <Pip size={120} state="think" color={pipColorValue} expression="happy" />
        <div className="font-display font-extrabold text-[22px] text-ink">
          Putting together what you learned…
        </div>
        <div className="font-body font-semibold text-[14px] text-ink-2">
          Pip is writing your recap. One moment!
        </div>
      </div>
    ) : (
      <div className="flex-1 bg-bg" />
    );
  }

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0 overflow-hidden"
      style={{ background: `radial-gradient(80% 60% at 50% 0%, var(--color-coral-l) 0%, var(--color-bg) 65%)` }}
    >
      <div className="flex items-center gap-3 px-[18px] py-3">
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center border-[1.5px] border-line cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => { end(); }}
          aria-label="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 5 L8 12 L15 19" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 text-center">
          <div className="font-body font-bold text-[11px] text-ink-3 uppercase tracking-[0.6px]">
            {picked ? subjectLabel(picked.subjectKind) : 'Pip'} · {picked?.topic ?? 'Live'}
          </div>
          <div className="font-display font-bold text-[16px] text-ink">{subjectTitle}</div>
        </div>
        <div
          className="px-3 py-[6px] rounded-full border-[1.5px] border-line font-mono text-[12px] font-bold text-ink-2"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
        >
          {state.status === 'resuming' ? 'one sec…' : state.status === 'connecting' ? 'connecting…' : 'live'}
        </div>
      </div>

      {state.cameraOffered && !showCamera && (
        <div className="px-[18px] -mt-1 mb-1 text-center">
          <span className="inline-block px-3 py-[5px] rounded-full bg-coral-l text-coral-d font-body font-bold text-[12px]">
            Tap "Show Pip" to share a picture!
          </span>
        </div>
      )}

      {/* Pip + status. Once the conversation has turns, Pip shrinks and moves up
          so the transcript below can take the freed vertical space. */}
      <div
        className={`flex flex-col items-center gap-3 px-4 ${
          hasTurns ? 'shrink-0 pt-1 pb-2' : 'flex-1 justify-center pt-2'
        }`}
      >
        <Pip size={hasTurns ? 96 : 180} state={pipState} color={pipColorValue} expression="happy" />
        <div className="inline-flex items-center gap-2 px-[14px] py-2 bg-surface border-[1.5px] border-line rounded-full font-body font-bold text-[13px] text-ink-2 shadow-[0_2px_0_rgba(0,0,0,0.04)]">
          {state.status === 'live' && !muted ? <Waveform color={accent} height={14} bars={4} /> : <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-ink-4)' }} />}
          <span>{muted ? 'Muted' : state.status === 'live' ? 'Listening…' : state.status === 'resuming' ? 'One sec…' : 'Connecting…'}</span>
        </div>
      </div>

      {hasTurns && (
        <div
          ref={transcriptRef}
          className="sb-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-[18px] pt-2 pb-1"
        >
          {turns.map((t, i) => (
            <Bubble key={i} from={t.role === 'pip' ? 'pip' : 'user'}>{t.text}</Bubble>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between px-6 pt-[14px] pb-[18px]">
        <ControlBtn
          label="Show Pip"
          onClick={() => { setShowCamera(true); consumeCameraOffer(); }}
          icon={
            <div className={state.cameraOffered ? 'animate-ring-pulse rounded-full' : ''}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="7" width="18" height="13" rx="3" stroke="var(--color-ink-2)" strokeWidth="2" />
                <circle cx="12" cy="13.5" r="3.5" stroke="var(--color-ink-2)" strokeWidth="2" />
                <path d="M8 7 L9.5 4.5 H14.5 L16 7" stroke="var(--color-ink-2)" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </div>
          }
        />
        <ControlBtn
          label={muted ? 'Unmute' : 'Mute'}
          onClick={() => { muted ? unmute() : mute(); setMuted((m) => !m); }}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="3" width="6" height="12" rx="3" stroke="var(--color-ink-2)" strokeWidth="2" />
              <path d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22" stroke="var(--color-ink-2)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
        <BigMic accent={accent} active={state.status === 'live' && !muted} onClick={() => { muted ? unmute() : mute(); setMuted((m) => !m); }} />
        <ControlBtn
          label="End"
          danger
          onClick={() => end()}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="var(--color-coral-d)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      {showCamera && (
        <SnapshotCapture
          onCapture={(b64) => { sendSnapshot(b64); setShowCamera(false); }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
