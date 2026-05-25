export default function App() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center gap-6">
      <div className="rounded-xl bg-coral px-6 py-4 font-display text-2xl font-extrabold text-white shadow-[0_4px_0_var(--color-coral-d)]">
        Pip
      </div>
      <div className="h-10 w-10 rounded-full bg-mint animate-pip-breathe" />
      <span className="font-mono text-ink-3">tokens OK</span>
    </div>
  );
}
