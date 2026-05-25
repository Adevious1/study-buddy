import { NavIcon } from './icons';

const ITEMS: { id: 'home' | 'library' | 'profile'; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Subjects' },
  { id: 'profile', label: 'Me' },
];

export function BottomNav({
  active,
  accent,
}: {
  active: 'home' | 'library' | 'profile';
  accent: string;
}) {
  return (
    <div className="border-t border-line bg-surface flex justify-around items-start px-[14px] pt-[10px] pb-[18px]">
      {ITEMS.map((item) => {
        const isActive = item.id === active;
        return (
          <div
            key={item.id}
            className="flex flex-col items-center gap-1 font-body font-bold text-[11px]"
            style={{ color: isActive ? accent : 'var(--color-ink-3)' }}
          >
            <NavIcon
              kind={item.id}
              active={isActive}
              color={accent}
              mute="var(--color-ink-3)"
            />
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
