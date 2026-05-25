import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { Star, Sparkle } from '../../components/ui/icons';
import { repository } from '../../data';
import { useResource } from '../../hooks/useResource';
import { usePipColor } from '../../state/PipColorContext';

// Inline confetti dot positions / colors from the reference
const CONFETTI = [
  { l: '8%',  t: 18, c: 'var(--color-coral)' },
  { l: '18%', t: 46, c: 'var(--color-mint)' },
  { l: '80%', t: 24, c: 'var(--color-lavender)' },
  { l: '92%', t: 52, c: 'var(--color-sun)' },
  { l: '70%', t: 62, c: 'var(--color-coral)' },
  { l: '25%', t: 80, c: 'var(--color-mint)' },
] as const;

export function RecapRoute() {
  const navigate = useNavigate();
  const { pipColorValue } = usePipColor();

  const recap = useResource(() => repository.getRecap());
  const student = useResource(() => repository.getStudent());

  // Guard: render placeholder until both resolve
  if (!recap || !student) {
    return <div className="flex-1 bg-bg" />;
  }

  return (
    <div className="flex flex-1 flex-col bg-bg overflow-auto sb-scroll">

      {/* Celebration header */}
      <div
        className="relative overflow-hidden px-5 pb-7 pt-5 text-center"
        style={{ background: 'linear-gradient(180deg, var(--color-sun-l) 0%, var(--color-bg) 100%)' }}
      >
        {/* Confetti dots */}
        {CONFETTI.map((d, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: d.l,
              top: d.t,
              width: 8,
              height: 8,
              background: d.c,
              opacity: 0.65,
            }}
          />
        ))}

        <Pip size={104} state="cheer" color={pipColorValue} expression="happy" />

        <div
          className="mt-2 font-display font-extrabold text-[26px] leading-[1.1] text-ink"
        >
          Awesome work,<br />{student.name}!
        </div>

        <div className="mt-1.5 font-body font-semibold text-[14px] text-ink-2">
          You and Pip just spent <b>{recap.minutes} minutes</b> on word problems.
        </div>
      </div>

      {/* Stars earned + Solved it yourself */}
      <div className="flex gap-[10px] px-4 pb-1 pt-3">
        <Card
          className="flex-1 border-[1.5px] border-line text-center"
          style={{ padding: 14, borderRadius: 20 }}
        >
          <div className="mb-1 flex justify-center gap-[3px]">
            {Array.from({ length: recap.starsMax }).map((_, i) => (
              <Star key={i} size={22} filled={i < recap.starsEarned} />
            ))}
          </div>
          <div className="font-body font-bold text-[11px] text-ink-3 uppercase tracking-wide">
            Stars Earned
          </div>
        </Card>

        <Card
          className="flex-1 border-[1.5px] border-line text-center"
          style={{ padding: 14, borderRadius: 20 }}
        >
          <div className="font-display font-extrabold text-[24px] text-ink">
            {recap.solvedSelf}
            <span className="text-[16px] text-ink-3">/{recap.solvedTotal}</span>
          </div>
          <div className="font-body font-bold text-[11px] text-ink-3 uppercase tracking-wide">
            Solved It Yourself
          </div>
        </Card>
      </div>

      {/* What we figured out */}
      <div className="px-4 pb-1 pt-3.5">
        <SectionTitle>What we figured out</SectionTitle>
        <Card
          className="border-[1.5px] border-line"
          style={{ padding: 4, borderRadius: 20 }}
        >
          {recap.figuredOut.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3"
              style={{
                padding: '12px 14px',
                borderBottom:
                  i < recap.figuredOut.length - 1 ? '1px solid var(--color-line)' : 'none',
              }}
            >
              {/* Icon circle */}
              <div
                className="flex shrink-0 items-center justify-center rounded-full"
                style={{
                  width: 24,
                  height: 24,
                  background: item.ok ? 'var(--color-mint)' : 'var(--color-sun)',
                }}
              >
                {item.ok ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12 L10 17 L19 7"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 7 V13"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="17" r="1.5" fill="white" />
                  </svg>
                )}
              </div>

              {/* Text */}
              <div
                className="flex-1 font-body font-semibold text-[14px]"
                style={{ color: item.ok ? 'var(--color-ink)' : 'var(--color-ink-2)' }}
              >
                {item.text}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Pip noticed — insight card */}
      <div className="px-4 pb-1 pt-3.5">
        <SectionTitle>Pip noticed…</SectionTitle>
        <Card
          className="flex gap-3 items-start"
          style={{ background: 'var(--color-lavender-l)', padding: 16, borderRadius: 22 }}
        >
          {/* Sparkle tile */}
          <div
            className="flex shrink-0 items-center justify-center rounded-[12px]"
            style={{
              width: 40,
              height: 40,
              background: 'var(--color-lavender)',
            }}
          >
            <Sparkle size={20} color="white" />
          </div>

          {/* Body */}
          <div className="flex-1">
            <div className="font-display font-bold text-[15px] text-ink">
              {recap.insightTitle}
            </div>
            <div className="mt-1 font-body font-semibold text-[13px] text-ink-2 leading-[1.35]">
              {recap.insightBody}
            </div>
            {/* Badge */}
            <div
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full font-mono text-[11px] font-bold text-lavender"
              style={{
                padding: '4px 10px',
                background: 'rgba(255,255,255,0.7)',
                letterSpacing: 0.4,
              }}
            >
              {recap.insightBadge}
            </div>
          </div>
        </Card>
      </div>

      {/* Buttons */}
      <div className="flex gap-2.5 px-4 py-[18px]">
        <Button kind="ghost" size="md" full onClick={() => navigate('/app/voice')}>
          Replay session
        </Button>
        <Button kind="primary" size="md" full onClick={() => navigate('/app')}>
          Done
        </Button>
      </div>

    </div>
  );
}
