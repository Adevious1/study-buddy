// ─────────────────────────────────────────────────────────────
// Study Buddy — main app
// Lays out all screens on a design canvas with grouped sections
// and a Tweaks panel for theme + state controls.
// ─────────────────────────────────────────────────────────────

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "pipColor":      "coral",
  "accentTheme":   "coral",
  "voiceState":    "listen",
  "showTranscript": true,
  "studentName":    "Maya"
}/*EDITMODE-END*/;

const PIP_PALETTE = {
  coral:    { hex: '#FF7B5A', token: 'var(--coral)' },
  mint:     { hex: '#4FCFA1', token: 'var(--mint)' },
  lavender: { hex: '#9D87E8', token: 'var(--lavender)' },
  sun:      { hex: '#FFCB47', token: 'var(--sun)' },
  sky:      { hex: '#5DB7FF', token: '#5DB7FF' },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const pipColor = PIP_PALETTE[t.pipColor]?.token || 'var(--coral)';
  const accent   = PIP_PALETTE[t.accentTheme]?.token || 'var(--coral)';

  const common = {
    accent,
    pipColor,
    studentName: t.studentName,
  };
  const iosCommon = { ...common, topInset: 54 };

  // iOS frame: device size 360×780; chrome height ~88px (status+indicator)
  // We'll use 374×812 for proper iPhone proportions to fit content.
  const iosW = 374, iosH = 812;
  const androidW = 384, androidH = 820;

  return (
    <>
      <DesignCanvas>

        {/* ───── Voice Session — hero ───── */}
        <DCSection id="voice" title="Voice Session" subtitle="The hero. Big Pip, transcript, hint chips, mic.">
          <DCArtboard id="voice-ios" label="iOS · Listening" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <VoiceScreen {...iosCommon} state={t.voiceState} showTranscript={t.showTranscript} />
            </IOSDevice>
          </DCArtboard>

          <DCArtboard id="voice-ios-speak" label="iOS · Pip speaking" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <VoiceScreen {...iosCommon} state="speak" showTranscript={t.showTranscript} />
            </IOSDevice>
          </DCArtboard>

          <DCArtboard id="voice-android" label="Android · Listening" width={androidW} height={androidH}>
            <AndroidDevice width={androidW} height={androidH}>
              <VoiceScreen {...common} state={t.voiceState} showTranscript={t.showTranscript} isAndroid />
            </AndroidDevice>
          </DCArtboard>
        </DCSection>

        {/* ───── Home / Today ───── */}
        <DCSection id="home" title="Home · Today" subtitle="Daily greeting from Pip, continue last session, today's adventures.">
          <DCArtboard id="home-ios" label="iOS" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <HomeScreen {...iosCommon} />
            </IOSDevice>
          </DCArtboard>

          <DCArtboard id="home-android" label="Android" width={androidW} height={androidH}>
            <AndroidDevice width={androidW} height={androidH}>
              <HomeScreen {...common} isAndroid />
            </AndroidDevice>
          </DCArtboard>
        </DCSection>

        {/* ───── Recap + Profile + Library ───── */}
        <DCSection id="after" title="After the session" subtitle="Recap celebration, learning-style profile, subject library.">
          <DCArtboard id="recap-ios" label="Recap · iOS" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <RecapScreen {...iosCommon} />
            </IOSDevice>
          </DCArtboard>

          <DCArtboard id="profile-ios" label="Profile · iOS" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <ProfileScreen {...iosCommon} />
            </IOSDevice>
          </DCArtboard>

          <DCArtboard id="library-ios" label="Library · iOS" width={iosW} height={iosH}>
            <IOSDevice width={iosW} height={iosH}>
              <LibraryScreen {...iosCommon} />
            </IOSDevice>
          </DCArtboard>
        </DCSection>

        {/* ───── Web ───── */}
        <DCSection id="web" title="Web" subtitle="Kid dashboard for the browser — same warmth at desktop scale.">
          <DCArtboard id="web-dash" label="Web · Today" width={1180} height={760}>
            <ChromeWindow
              width={1180} height={760}
              tabs={[{ title: 'Study Buddy — Today' }, { title: 'Khan Academy' }]}
              activeIndex={0}
              url="studybuddy.app/today"
            >
              <WebDashboard {...common} />
            </ChromeWindow>
          </DCArtboard>
        </DCSection>

      </DesignCanvas>

      {/* ───── Tweaks ───── */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Pip & theme">
          <TweakColor
            label="Pip's color"
            value={t.pipColor}
            options={Object.keys(PIP_PALETTE).map(k => PIP_PALETTE[k].hex)}
            onChange={(hex) => {
              const key = Object.keys(PIP_PALETTE).find(k => PIP_PALETTE[k].hex === hex);
              if (key) setTweak('pipColor', key);
            }}
          />
          <TweakColor
            label="Accent (CTAs, nav)"
            value={t.accentTheme}
            options={Object.keys(PIP_PALETTE).map(k => PIP_PALETTE[k].hex)}
            onChange={(hex) => {
              const key = Object.keys(PIP_PALETTE).find(k => PIP_PALETTE[k].hex === hex);
              if (key) setTweak('accentTheme', key);
            }}
          />
        </TweakSection>

        <TweakSection label="Voice screen">
          <TweakRadio
            label="State"
            value={t.voiceState}
            options={['listen', 'speak', 'think']}
            onChange={(v) => setTweak('voiceState', v)}
          />
          <TweakToggle
            label="Live transcript"
            value={t.showTranscript}
            onChange={(v) => setTweak('showTranscript', v)}
          />
        </TweakSection>

        <TweakSection label="Student">
          <TweakText
            label="Name"
            value={t.studentName}
            onChange={(v) => setTweak('studentName', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
