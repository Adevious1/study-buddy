// ─────────────────────────────────────────────────────────────
// Home / Today screen — warm greeting, today's assignments,
// streak, "continue last session"
// ─────────────────────────────────────────────────────────────

function HomeScreen({ accent = 'var(--coral)', pipColor = 'var(--coral)', studentName = 'Maya', isAndroid = false, topInset = 0 }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
      overflow: 'auto',
      paddingTop: topInset,
    }} className="sb-scroll">

      {/* Greeting block */}
      <div style={{ padding: '14px 20px 16px' }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--ink-3)',
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>Tuesday · April 22</div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32, lineHeight: 1.05,
          color: 'var(--ink)', marginTop: 4,
        }}>Hi {studentName}!</div>
      </div>

      {/* Pip greeting card */}
      <div style={{ padding: '0 16px' }}>
        <SBCard color="var(--surface)" pad={16} radius={28} style={{
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 4px 0 #F0DFC9',
        }}>
          <Pip size={72} state="idle" color={pipColor} expression="happy" shadow={false} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
              color: 'var(--ink)', marginBottom: 4,
            }}>Ready to learn together?</div>
            <div style={{
              fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
              color: 'var(--ink-3)', lineHeight: 1.3,
            }}>Pip is here whenever you are.</div>
          </div>
        </SBCard>
      </div>

      {/* Streak + stars stat row */}
      <div style={{ padding: '14px 16px 4px', display: 'flex', gap: 10 }}>
        <SBCard color="var(--surface)" pad={14} radius={20} style={{ flex: 1, border: '1.5px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SBFlame size={22} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--ink)' }}>5</span>
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>DAY STREAK</div>
        </SBCard>
        <SBCard color="var(--surface)" pad={14} radius={20} style={{ flex: 1, border: '1.5px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <SBStar size={20} />
            <SBStar size={20} />
            <SBStar size={20} />
            <SBStar size={20} filled={false} />
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>STARS TODAY</div>
        </SBCard>
      </div>

      {/* Today's assignments */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle action="See all">Today's adventures</SectionTitle>

        {/* Continue last session — featured */}
        <SBCard color="var(--ink)" pad={18} radius={24} style={{ marginBottom: 10, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', right: -20, top: -10, opacity: 0.85,
          }}>
            <Pip size={110} state="idle" color={pipColor} expression="curious" shadow={false} />
          </div>
          <div style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 99,
            background: 'rgba(255,255,255,0.12)', color: 'white',
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}>Continue</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
            color: 'white', marginTop: 10, maxWidth: '70%', lineHeight: 1.1,
          }}>Fractions with pizza</div>
          <div style={{
            fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,
            color: 'rgba(255,255,255,0.7)', marginTop: 6,
          }}>We stopped at question 3 of 5</div>
          <div style={{ marginTop: 14 }}>
            <SBButton kind="primary" size="sm">Pick up where we left off →</SBButton>
          </div>
        </SBCard>

        <AssignmentCard
          subject="Reading"
          title="Charlotte's Web, Ch. 3"
          mins={10}
          stars={0}
          totalStars={3}
          color="var(--mint)"
          softColor="var(--mint-l)"
          iconKind="reading"
        />
        <AssignmentCard
          subject="Math"
          title="Word problems"
          mins={15}
          stars={2}
          totalStars={3}
          color="var(--lavender)"
          softColor="var(--lavender-l)"
          iconKind="math"
        />
        <AssignmentCard
          subject="Spelling"
          title="-tion words"
          mins={5}
          stars={0}
          totalStars={3}
          color="var(--sun)"
          softColor="var(--sun-l)"
          iconKind="writing"
          last
        />
      </div>

      <div style={{ height: 24 }} />

      <BottomNav active="home" accent={accent} />
    </div>
  );
}

function AssignmentCard({ subject, title, mins, stars, totalStars, color, softColor, iconKind, last }) {
  return (
    <SBCard color="var(--surface)" pad={14} radius={22} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      border: '1.5px solid var(--line)',
      marginBottom: last ? 0 : 10,
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 16,
        background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <SubjectIcon kind={iconKind} size={26} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink-3)',
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>{subject} · {mins} min</div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--ink)',
          marginTop: 1,
        }}>{title}</div>
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          {Array.from({ length: totalStars }).map((_, i) => (
            <SBStar key={i} size={13} filled={i < stars} />
          ))}
        </div>
      </div>
      <div style={{
        width: 36, height: 36, borderRadius: 99,
        background: softColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: color, fontSize: 20, fontWeight: 800, flexShrink: 0,
      }}>›</div>
    </SBCard>
  );
}

Object.assign(window, { HomeScreen, AssignmentCard });
