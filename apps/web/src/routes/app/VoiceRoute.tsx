import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Waveform } from '../../components/ui/Waveform';
import { Bubble } from '../../components/ui/Bubble';
import { HintChip } from '../../components/ui/HintChip';
import { Sparkle } from '../../components/ui/icons';
import { usePipColor } from '../../state/PipColorContext';

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

export function VoiceRoute() {
  const [active, setActive] = useState(true);
  const navigate = useNavigate();
  const { pipColorValue } = usePipColor();

  const voiceState: 'listen' | 'idle' = active ? 'listen' : 'idle';
  const accent = pipColorValue;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{
        background: `radial-gradient(80% 60% at 50% 0%, var(--color-coral-l) 0%, var(--color-bg) 65%)`,
      }}
    >
      {/* Top bar — session context */}
      <div className="flex items-center gap-3 px-[18px] py-3">
        {/* Back chevron */}
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center border-[1.5px] border-line cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={() => navigate('/app')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5 L8 12 L15 19"
              stroke="var(--color-ink)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Center: subject + question */}
        <div className="flex-1 text-center">
          <div className="font-body font-bold text-[11px] text-ink-3 uppercase tracking-[0.6px]">
            Math · Word problems
          </div>
          <div className="font-display font-bold text-[16px] text-ink">
            Question 3 of 5
          </div>
        </div>

        {/* Timer */}
        <div
          className="px-3 py-[6px] rounded-full border-[1.5px] border-line font-mono text-[12px] font-bold text-ink-2"
          style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)' }}
        >
          12:34
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-[6px] mb-1">
        {[1, 1, 1, 0, 0].map((on, i) => (
          <div
            key={i}
            className="h-2 rounded-full transition-[width] duration-200"
            style={{
              width: i === 2 ? 22 : 8,
              background: on ? accent : 'var(--color-line)',
            }}
          />
        ))}
      </div>

      {/* Pip hero + state chip */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 pt-2">
        <Pip size={180} state={voiceState} color={accent} expression="happy" />

        {/* State chip */}
        <div className="inline-flex items-center gap-2 px-[14px] py-2 bg-surface border-[1.5px] border-line rounded-full font-body font-bold text-[13px] text-ink-2 shadow-[0_2px_0_rgba(0,0,0,0.04)]">
          {voiceState === 'listen' && (
            <Waveform color={accent} height={14} bars={4} />
          )}
          {voiceState === 'idle' && (
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-ink-4)' }} />
          )}
          <span>{voiceState === 'listen' ? 'Listening…' : 'Paused'}</span>
        </div>
      </div>

      {/* Transcript bubbles */}
      <div className="flex flex-col gap-2 px-[18px] pt-3 pb-1">
        <Bubble from="pip">
          If 12 apples are shared between 4 friends, how many does each friend get?
        </Bubble>
        <Bubble from="user">
          Hmm… is it 8?
        </Bubble>
      </div>

      {/* Hint chips — horizontal scroll */}
      <div className="flex gap-2 px-4 pt-[10px] overflow-x-auto sb-scroll">
        <HintChip icon={<Sparkle size={12} />}>Try drawing it</HintChip>
        <HintChip>Need a hint?</HintChip>
        <HintChip>Read again</HintChip>
        <HintChip>Slower please</HintChip>
      </div>

      {/* Control row: Mute | BigMic | End */}
      <div className="flex items-center justify-between px-6 pt-[14px] pb-[18px]">
        <ControlBtn
          label="Mute"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="3" width="6" height="12" rx="3" stroke="var(--color-ink-2)" strokeWidth="2" />
              <path
                d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22"
                stroke="var(--color-ink-2)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <BigMic
          accent={accent}
          active={active}
          onClick={() => setActive((a) => !a)}
        />

        <ControlBtn
          label="End"
          danger
          onClick={() => navigate('/app/recap')}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6 L18 18 M18 6 L6 18"
                stroke="var(--color-coral-d)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          }
        />
      </div>
    </div>
  );
}
