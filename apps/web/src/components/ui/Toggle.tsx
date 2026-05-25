interface ToggleProps {
  on: boolean;
  accent?: string;
  onChange?: (v: boolean) => void;
}

export function Toggle({ on, accent = 'var(--color-coral)', onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange?.(!on)}
      className="relative shrink-0 border-0 p-0 cursor-pointer"
      style={{
        width: 42,
        height: 24,
        borderRadius: 99,
        background: on ? accent : 'var(--color-line)',
        transition: 'background .2s',
        outline: 'none',
      }}
    >
      <span
        className="absolute"
        style={{
          top: 2,
          left: on ? 20 : 2,
          width: 20,
          height: 20,
          borderRadius: 99,
          background: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          transition: 'left .2s',
        }}
      />
    </button>
  );
}
