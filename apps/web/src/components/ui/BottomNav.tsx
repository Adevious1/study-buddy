import { NavLink } from 'react-router-dom';
import { NavIcon } from './icons';

const ITEMS: { id: 'home' | 'library' | 'profile'; label: string; to: string }[] = [
  { id: 'home', label: 'Home', to: '/app' },
  { id: 'library', label: 'Subjects', to: '/app/subjects' },
  { id: 'profile', label: 'Me', to: '/app/me' },
];

export function BottomNav({
  accent,
}: {
  accent: string;
}) {
  return (
    <div className="border-t border-line bg-surface flex justify-around items-start px-[14px] pt-[10px] pb-[18px]">
      {ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.id === 'home'}
          className="flex flex-col items-center gap-1 font-body font-bold text-[11px] no-underline"
          style={({ isActive }) => ({ color: isActive ? accent : 'var(--color-ink-3)' })}
        >
          {({ isActive }) => (
            <>
              <NavIcon
                kind={item.id}
                active={isActive}
                color={accent}
                mute="var(--color-ink-3)"
              />
              <span>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}
