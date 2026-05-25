// ─────────────────────────────────────────────────────────────
// Session Recap — celebration, what we learned, learning style
// nudge, quick replay
// ─────────────────────────────────────────────────────────────

function RecapScreen({ accent = 'var(--coral)', pipColor = 'var(--coral)', studentName = 'Maya', isAndroid = false, topInset = 0 }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      overflow: 'auto',
      paddingTop: topInset,
    }} className="sb-scroll">

      {/* Celebration header */}
      <div style={{
        background: `linear-gradient(180deg, var(--sun-l) 0%, var(--bg) 100%)`,
        padding: '20px 20px 28px',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        {/* confetti dots */}
        {[
          {l:'8%',  t:18, c:'var(--coral)'},
          {l:'18%', t:46, c:'var(--mint)'},
          {l:'80%', t:24, c:'var(--lavender)'},
          {l:'92%', t:52, c:'var(--sun)'},
          {l:'70%', t:62, c:'var(--coral)'},
          {l:'25%', t:80, c:'var(--mint)'},
        ].map((d, i) => (
          <div key={i} style={{
            position: 'absolute', left: d.l, top: d.t,
            width: 8, height: 8, borderRadius: 99, background: d.c, opacity: 0.65,
          }} />
        ))}
        <Pip size={104} state="cheer" color={pipColor} expression="happy" />
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, lineHeight: 1.1,
          color: 'var(--ink)', marginTop: 8,
        }}>Awesome work,<br/>{studentName}!</div>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,
          color: 'var(--ink-2)', marginTop: 6,
        }}>You and Pip just spent <b>14 minutes</b> on word problems.</div>
      </div>

      {/* Stars earned */}
      <div style={{ padding: '12px 16px 4px', display: 'flex', gap: 10 }}>
        <SBCard color="var(--surface)" pad={14} radius={20} style={{
          flex: 1, border: '1.5px solid var(--line)', textAlign: 'center',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginBottom: 4 }}>
            <SBStar size={22} /><SBStar size={22} /><SBStar size={22} filled={false} />
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)' }}>STARS EARNED</div>
        </SBCard>
        <SBCard color="var(--surface)" pad={14} radius={20} style={{
          flex: 1, border: '1.5px solid var(--line)', textAlign: 'center',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, color: 'var(--ink)' }}>4<span style={{ color: 'var(--ink-3)', fontSize: 16 }}>/5</span></div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)' }}>SOLVED IT YOURSELF</div>
        </SBCard>
      </div>

      {/* What we learned */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle>What we figured out</SectionTitle>
        <SBCard color="var(--surface)" pad={4} radius={20} style={{ border: '1.5px solid var(--line)' }}>
          {[
            { ok: true,  text: 'Sharing means dividing equally' },
            { ok: true,  text: '12 ÷ 4 = 3' },
            { ok: true,  text: 'Drawing groups helps with division' },
            { ok: false, text: 'When the leftover is tricky — try again tomorrow' },
          ].map((r, i, arr) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 99, flexShrink: 0,
                background: r.ok ? 'var(--mint)' : 'var(--sun)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {r.ok
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12 L10 17 L19 7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 7 V13" stroke="white" strokeWidth="3" strokeLinecap="round" /><circle cx="12" cy="17" r="1.5" fill="white"/></svg>
                }
              </div>
              <div style={{
                flex: 1, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,
                color: r.ok ? 'var(--ink)' : 'var(--ink-2)',
              }}>{r.text}</div>
            </div>
          ))}
        </SBCard>
      </div>

      {/* Learning style insight */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle>Pip noticed…</SectionTitle>
        <SBCard color="var(--lavender-l)" pad={16} radius={22} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: 'var(--lavender)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <SBSparkle size={20} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>You're a picture person!</div>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)',
              marginTop: 4, lineHeight: 1.35,
            }}>You solved it faster when we drew the apples. Next time Pip will start with a picture.</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginTop: 10, padding: '4px 10px',
              background: 'rgba(255,255,255,0.7)', borderRadius: 99,
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--lavender)',
              letterSpacing: 0.4,
            }}>
              VISUAL +1
            </div>
          </div>
        </SBCard>
      </div>

      {/* Buttons */}
      <div style={{ padding: '18px 16px 18px', display: 'flex', gap: 10 }}>
        <SBButton kind="ghost" size="md" full>Replay session</SBButton>
        <SBButton kind="primary" size="md" full>Done</SBButton>
      </div>

      <BottomNav active="home" accent={accent} />
    </div>
  );
}

Object.assign(window, { RecapScreen });
