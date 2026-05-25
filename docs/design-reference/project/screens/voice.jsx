// ─────────────────────────────────────────────────────────────
// Voice Session — the hero screen.
// Big animated Pip, live transcript (toggleable), Socratic hint
// chips, big mic control with active state ring.
// ─────────────────────────────────────────────────────────────

function VoiceScreen({
  accent = 'var(--coral)',
  pipColor = 'var(--coral)',
  state = 'listen',         // 'listen' | 'speak' | 'think'
  showTranscript = true,
  isAndroid = false,
  topInset = 0,
}) {
  const stateLabel = {
    listen: 'Listening…',
    speak:  'Pip is talking',
    think:  'Pip is thinking',
  }[state];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: `radial-gradient(80% 60% at 50% 0%, var(--coral-l) 0%, var(--bg) 65%)`,
      overflow: 'hidden',
      paddingTop: topInset,
    }}>

      {/* Top bar — session context */}
      <div style={{
        padding: '12px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 99,
          background: 'rgba(255,255,255,0.7)', border: '1.5px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 5 L8 12 L15 19" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)',
            letterSpacing: 0.6, textTransform: 'uppercase',
          }}>Math · Word problems</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)',
          }}>Question 3 of 5</div>
        </div>
        <div style={{
          padding: '6px 12px', borderRadius: 99,
          background: 'rgba(255,255,255,0.7)', border: '1.5px solid var(--line)',
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--ink-2)',
          backdropFilter: 'blur(8px)',
        }}>12:34</div>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
        {[1,1,1,0,0].map((on, i) => (
          <div key={i} style={{
            width: i === 2 ? 22 : 8, height: 8, borderRadius: 99,
            background: on ? accent : 'var(--line)',
            transition: 'width .2s',
          }} />
        ))}
      </div>

      {/* Pip — hero */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: '8px 16px 0',
      }}>
        <Pip size={180} state={state} color={pipColor} expression="happy" />

        {/* State chip */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          background: 'var(--surface)',
          border: '1.5px solid var(--line)',
          borderRadius: 999,
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--ink-2)',
          boxShadow: '0 2px 0 rgba(0,0,0,0.04)',
        }}>
          {state === 'listen' && <Waveform color={accent} height={14} bars={4} />}
          {state === 'think' && (
            <div style={{ display: 'flex', gap: 3 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: 99, background: accent,
                  animation: `pip-listen 1s ease-in-out ${i*0.15}s infinite`,
                }} />
              ))}
            </div>
          )}
          {state === 'speak' && <Waveform color={accent} height={14} bars={5} />}
          <span>{stateLabel}</span>
        </div>
      </div>

      {/* Transcript bubbles */}
      {showTranscript && (
        <div style={{
          padding: '12px 18px 4px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <Bubble from="pip">
            If 12 apples are shared between 4 friends, how many does each friend get?
          </Bubble>
          <Bubble from="user">
            Hmm… is it 8?
          </Bubble>
        </div>
      )}

      {/* Hint chips */}
      <div style={{
        padding: '10px 16px 0',
        display: 'flex', gap: 8, overflowX: 'auto',
      }} className="sb-scroll">
        <HintChip icon={<SBSparkle size={12} />}>Try drawing it</HintChip>
        <HintChip>Need a hint?</HintChip>
        <HintChip>Read again</HintChip>
        <HintChip>Slower please</HintChip>
      </div>

      {/* Mic control row */}
      <div style={{
        padding: '14px 24px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <ControlBtn label="Mute" icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="3" width="6" height="12" rx="3" stroke="var(--ink-2)" strokeWidth="2" />
            <path d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        } />

        <BigMic accent={accent} active={state === 'listen'} />

        <ControlBtn label="End" danger icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="var(--coral-d)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        } />
      </div>
    </div>
  );
}

function ControlBtn({ icon, label, danger }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 56, height: 56, borderRadius: 99,
        background: 'var(--surface)',
        border: `1.5px solid ${danger ? 'var(--coral-l)' : 'var(--line)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 0 rgba(0,0,0,0.04)',
      }}>
        {icon}
      </div>
      <div style={{
        fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11,
        color: danger ? 'var(--coral-d)' : 'var(--ink-3)',
        letterSpacing: 0.4, textTransform: 'uppercase',
      }}>{label}</div>
    </div>
  );
}

function BigMic({ accent, active }) {
  return (
    <div style={{ position: 'relative', width: 96, height: 96 }}>
      {/* pulse rings */}
      {active && (
        <>
          {[0, 0.6, 1.2].map((d, i) => (
            <div key={i} style={{
              position: 'absolute', inset: 0, borderRadius: 99,
              border: `2px solid ${accent}`, opacity: 0,
              animation: `ring-pulse 2s ease-out ${d}s infinite`,
            }} />
          ))}
        </>
      )}
      <div style={{
        position: 'relative',
        width: 96, height: 96, borderRadius: 99,
        background: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 6px 0 var(--coral-d), 0 12px 24px rgba(229,97,74,0.35)`,
      }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="3" width="6" height="12" rx="3" fill="white" />
          <path d="M5 11 C5 15 8 18 12 18 C16 18 19 15 19 11 M12 18 V22" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

Object.assign(window, { VoiceScreen, BigMic });
