/** Something a graceful shutdown can finalize. */
export interface Drainable {
  shutdown(): Promise<void>;
}

export interface RelayRegistry {
  register(d: Drainable): void;
  unregister(d: Drainable): void;
  size(): number;
  /** Finalize every live relay concurrently, bounded by timeoutMs. */
  drainAll(timeoutMs: number): Promise<void>;
  beginDraining(): void;
  isDraining(): boolean;
}

export function createRelayRegistry(): RelayRegistry {
  const live = new Set<Drainable>();
  let draining = false;
  return {
    register: (d) => { live.add(d); },
    unregister: (d) => { live.delete(d); },
    size: () => live.size,
    async drainAll(timeoutMs) {
      const all = Promise.allSettled([...live].map((d) => d.shutdown()));
      await Promise.race([
        all,
        new Promise<void>((resolve) => { const t = setTimeout(resolve, timeoutMs); t.unref?.(); }),
      ]);
    },
    beginDraining: () => { draining = true; },
    isDraining: () => draining,
  };
}

/** Process-wide singleton used by the live voice route + the SIGTERM handler. */
export const relayRegistry = createRelayRegistry();
