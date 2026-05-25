// ─────────────────────────────────────────────────────────────
// Web — kid dashboard for the browser. Left rail nav, main
// content with today's adventures + active session preview.
// ─────────────────────────────────────────────────────────────

function WebDashboard({ accent = 'var(--coral)', pipColor = 'var(--coral)' }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', background: 'var(--bg)',
      fontFamily: 'var(--font-body)',
    }}>
      {/* Left rail */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1.5px solid var(--line)',
        padding: '24px 20px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <Pip size={36} state="idle" color={pipColor} expression="happy" shadow={false} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--ink)' }}>Study Buddy</div>
        </div>

        {[
          { id: 'home', label: 'Today', active: true },
          { id: 'library', label: 'Subjects' },
          { id: 'history', label: 'My sessions' },
          { id: 'profile', label: 'How I learn' },
        ].map(n => (
          <div key={n.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 14,
            background: n.active ? 'var(--coral-l)' : 'transparent',
            color: n.active ? 'var(--coral-d)' : 'var(--ink-2)',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 99,
              background: n.active ? 'var(--coral)' : 'var(--ink-4)',
            }} />
            {n.label}
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: 14, borderRadius: 16, background: 'var(--bg-2)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SBFlame size={20} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>5 days</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Keep your streak going!</div>
        </div>

        {/* User chip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 8, marginTop: 14,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 99,
            background: 'var(--mint)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14,
          }}>M</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--ink)' }}>Maya</div>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--ink-3)' }}>Grade 3</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{
        flex: 1, padding: '24px 32px', overflow: 'auto',
      }} className="sb-scroll">

        {/* Greeting row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--ink-3)', letterSpacing: 0.6, textTransform: 'uppercase' }}>Tuesday · April 22</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, lineHeight: 1.05, color: 'var(--ink)', marginTop: 4 }}>Hi Maya!</div>
          </div>
          <SBButton kind="primary" size="md">Start a session</SBButton>
        </div>

        {/* Continue card + stats split */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 18 }}>
          {/* Continue */}
          <div style={{
            background: 'var(--ink)', color: 'white', borderRadius: 28,
            padding: 24, position: 'relative', overflow: 'hidden',
            minHeight: 200,
          }}>
            <div style={{ position: 'absolute', right: 20, bottom: 0, opacity: 0.92 }}>
              <Pip size={170} state="speak" color={pipColor} expression="happy" shadow={false} />
            </div>
            <div style={{
              display: 'inline-block', padding: '5px 12px', borderRadius: 99,
              background: 'rgba(255,255,255,0.12)',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              letterSpacing: 0.6, textTransform: 'uppercase',
            }}>In progress</div>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32,
              lineHeight: 1.05, marginTop: 12, maxWidth: '60%',
            }}>Fractions with pizza</div>
            <div style={{
              fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginTop: 8,
              maxWidth: '55%',
            }}>You and Pip stopped at question 3 of 5. Ready to keep going?</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <SBButton kind="primary" size="md">Pick up where we left off</SBButton>
              <SBButton kind="ghost" size="md" style={{ color: 'rgba(255,255,255,0.85)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.2)' }}>Replay</SBButton>
            </div>
          </div>

          {/* Stats column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SBCard color="var(--surface)" pad={18} radius={22} style={{ border: '1.5px solid var(--line)' }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--ink-3)', letterSpacing: 0.5, textTransform: 'uppercase' }}>This week</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, color: 'var(--ink)' }}>1h 12m</span>
                <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--mint)' }}>+18m</span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12, height: 36, alignItems: 'flex-end' }}>
                {[60, 35, 80, 20, 75, 0, 0].map((h, i) => (
                  <div key={i} style={{
                    flex: 1, height: `${Math.max(h, 6)}%`,
                    background: i < 5 ? 'var(--coral)' : 'var(--bg-2)',
                    borderRadius: 4,
                  }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>
                {['M','T','W','T','F','S','S'].map((d, i) => <span key={i}>{d}</span>)}
              </div>
            </SBCard>

            <SBCard color="var(--lavender-l)" pad={18} radius={22}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <SBSparkle size={20} color="var(--lavender)" />
                <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--lavender)', letterSpacing: 0.5, textTransform: 'uppercase' }}>Pip's noticing</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginTop: 6, lineHeight: 1.25 }}>
                You learn best when we draw it out first.
              </div>
            </SBCard>
          </div>
        </div>

        {/* Today's adventures */}
        <div style={{ marginBottom: 12 }}>
          <SectionTitle action="See all subjects →">Today's adventures</SectionTitle>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { subject: 'Math',     title: 'Word problems',   mins: 15, color: 'var(--lavender)', soft: 'var(--lavender-l)', kind: 'math' },
            { subject: 'Reading',  title: "Charlotte's Web, Ch. 3", mins: 10, color: 'var(--mint)',     soft: 'var(--mint-l)',     kind: 'reading' },
            { subject: 'Spelling', title: '-tion words',     mins: 5,  color: 'var(--sun)',      soft: 'var(--sun-l)',      kind: 'writing' },
          ].map(c => (
            <SBCard key={c.subject} color="var(--surface)" pad={18} radius={22} style={{
              border: '1.5px solid var(--line)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <SubjectIcon kind={c.kind} size={26} />
                </div>
                <div style={{
                  padding: '4px 10px', borderRadius: 99,
                  background: c.soft, color: c.color,
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10, letterSpacing: 0.4,
                  textTransform: 'uppercase',
                }}>{c.mins} min</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--ink-3)', letterSpacing: 0.5, textTransform: 'uppercase' }}>{c.subject}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginTop: 2 }}>{c.title}</div>
              </div>
              <SBButton kind="soft" size="sm" full>Start →</SBButton>
            </SBCard>
          ))}
        </div>

      </main>
    </div>
  );
}

Object.assign(window, { WebDashboard });
