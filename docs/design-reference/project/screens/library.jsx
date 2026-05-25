// ─────────────────────────────────────────────────────────────
// Subject Library — pick a subject to start a session
// ─────────────────────────────────────────────────────────────

function LibraryScreen({ accent = 'var(--coral)', pipColor = 'var(--coral)', isAndroid = false, topInset = 0 }) {
  const subjects = [
    { kind: 'math',    label: 'Math',         topic: 'Word problems',     color: 'var(--lavender)', soft: 'var(--lavender-l)' },
    { kind: 'reading', label: 'Reading',      topic: 'Charlotte\'s Web',  color: 'var(--mint)',     soft: 'var(--mint-l)' },
    { kind: 'science', label: 'Science',      topic: 'Plants & light',    color: 'var(--coral)',    soft: 'var(--coral-l)' },
    { kind: 'writing', label: 'Writing',      topic: 'Story ideas',       color: 'var(--sun)',      soft: 'var(--sun-l)' },
    { kind: 'spanish', label: 'Spanish',      topic: '20 new words',      color: '#5DB7FF',         soft: '#D6ECFF' },
    { kind: 'social',  label: 'Social Studies', topic: 'Our community',   color: '#E07AB3',         soft: '#FAD5EA' },
  ];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', overflow: 'auto',
      paddingTop: topInset,
    }} className="sb-scroll">

      <div style={{ padding: '14px 20px 8px' }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)',
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>Pick a subject</div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28,
          color: 'var(--ink)', marginTop: 2,
        }}>Subjects</div>
      </div>

      {/* Free-talk card */}
      <div style={{ padding: '6px 16px 10px' }}>
        <SBCard color="var(--ink)" pad={16} radius={22} style={{
          display: 'flex', alignItems: 'center', gap: 14, position: 'relative', overflow: 'hidden',
        }}>
          <Pip size={64} state="speak" color={pipColor} expression="happy" shadow={false} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'white' }}>Just talk with Pip</div>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,
              color: 'rgba(255,255,255,0.7)', marginTop: 2,
            }}>Ask anything from class or homework</div>
          </div>
          <div style={{
            width: 36, height: 36, borderRadius: 99,
            background: accent, color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 18,
          }}>›</div>
        </SBCard>
      </div>

      {/* Grid */}
      <div style={{
        padding: '4px 16px 16px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        {subjects.map(s => (
          <SBCard key={s.kind} color={s.soft} pad={14} radius={22} style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            minHeight: 130,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14,
              background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SubjectIcon kind={s.kind} size={24} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--ink)',
              }}>{s.label}</div>
              <div style={{
                fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,
                color: 'var(--ink-3)', marginTop: 2,
              }}>{s.topic}</div>
            </div>
          </SBCard>
        ))}
      </div>

      <BottomNav active="library" accent={accent} />
    </div>
  );
}

Object.assign(window, { LibraryScreen });
