// ─────────────────────────────────────────────────────────────
// Profile / "Me" — how I learn, customize Pip, streak calendar
// ─────────────────────────────────────────────────────────────

function ProfileScreen({ accent = 'var(--coral)', pipColor = 'var(--coral)', studentName = 'Maya', isAndroid = false, topInset = 0 }) {
  const pipColors = [
    'var(--coral)', 'var(--mint)', 'var(--lavender)', 'var(--sun)', '#5DB7FF',
  ];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      overflow: 'auto',
      paddingTop: topInset,
    }} className="sb-scroll">

      {/* Header */}
      <div style={{ padding: '14px 20px 6px' }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
          color: 'var(--ink)',
        }}>{studentName}</div>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
          color: 'var(--ink-3)',
        }}>Age 8 · Grade 3 · Learning with Pip since Feb</div>
      </div>

      {/* Customize Pip */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SBCard color="var(--surface)" pad={18} radius={24} style={{
          border: '1.5px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 96, height: 96, borderRadius: 24,
            background: 'var(--bg-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Pip size={76} state="idle" color={pipColor} expression="happy" shadow={false} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>Meet Pip</div>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)',
              marginTop: 2,
            }}>Pick a color</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {pipColors.map((c) => (
                <div key={c} style={{
                  width: 26, height: 26, borderRadius: 99, background: c,
                  border: c === pipColor ? '2.5px solid var(--ink)' : '2.5px solid transparent',
                  boxShadow: c === pipColor ? '0 0 0 2px var(--bg)' : 'none',
                }} />
              ))}
            </div>
          </div>
        </SBCard>
      </div>

      {/* How I learn */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle>How I learn best</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <StyleBadge
            label="Pictures & diagrams"
            score={82}
            color="var(--lavender)"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="white" strokeWidth="2" />
              <circle cx="9" cy="10" r="1.5" fill="white" />
              <path d="M5 17 L10 13 L14 16 L19 11" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>}
          />
          <StyleBadge
            label="Stories & examples"
            score={68}
            color="var(--mint)"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 6 L11 4 L11 19 L4 17 Z M20 6 L13 4 L13 19 L20 17 Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            </svg>}
          />
          <StyleBadge
            label="Hands-on practice"
            score={54}
            color="var(--coral)"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 4 L9 13 M9 13 L5 13 L5 20 L15 20 L15 13 L9 13 Z M13 6 L17 6 L17 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
          />
          <StyleBadge
            label="Hearing it out loud"
            score={41}
            color="var(--sun)"
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M5 9 L5 15 L9 15 L14 19 L14 5 L9 9 Z" fill="white" />
              <path d="M17 8 C19 10 19 14 17 16" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>}
          />
        </div>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5, color: 'var(--ink-3)',
          marginTop: 10, padding: '0 4px', lineHeight: 1.4,
        }}>
          Pip updates this from your sessions — it's how each new conversation gets a little more "you".
        </div>
      </div>

      {/* This week's streak */}
      <div style={{ padding: '16px 16px 4px' }}>
        <SectionTitle action="View all">This week</SectionTitle>
        <SBCard color="var(--surface)" pad={14} radius={22} style={{ border: '1.5px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {['M','T','W','T','F','S','S'].map((d, i) => {
              const done = i < 5;
              const today = i === 4;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 99,
                    background: done ? accent : 'var(--bg-2)',
                    color: done ? 'white' : 'var(--ink-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-body)', fontWeight: 800, fontSize: 12,
                    border: today ? '2.5px solid var(--ink)' : 'none',
                  }}>
                    {done && <SBFlame size={16} color="white" />}
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    color: 'var(--ink-3)',
                  }}>{d}</span>
                </div>
              );
            })}
          </div>
        </SBCard>
      </div>

      {/* Settings */}
      <div style={{ padding: '14px 16px 14px' }}>
        <SectionTitle>Settings</SectionTitle>
        <SBCard color="var(--surface)" pad={2} radius={20} style={{ border: '1.5px solid var(--line)' }}>
          {[
            { label: 'Show live transcript', sub: 'Words appear as we talk', toggle: true },
            { label: 'Pip\'s voice speed', detail: 'Just right' },
            { label: 'Read to me', sub: 'For questions you can\'t read yet', toggle: false },
            { label: 'Grown-up dashboard', detail: 'Set up' },
          ].map((row, i, arr) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{row.label}</div>
                {row.sub && <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>{row.sub}</div>}
              </div>
              {row.toggle !== undefined
                ? <Toggle on={row.toggle} accent={accent} />
                : <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--coral-d)' }}>{row.detail} ›</span>
              }
            </div>
          ))}
        </SBCard>
      </div>

      <BottomNav active="profile" accent={accent} />
    </div>
  );
}

function Toggle({ on, accent }) {
  return (
    <div style={{
      width: 42, height: 24, borderRadius: 99,
      background: on ? accent : 'var(--line)',
      position: 'relative',
      transition: 'background .2s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 20, height: 20, borderRadius: 99, background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        transition: 'left .2s',
      }} />
    </div>
  );
}

Object.assign(window, { ProfileScreen });
