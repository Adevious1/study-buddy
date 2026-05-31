import type { RecapGenerator } from './generateRecap';

/** A scripted recap generator for tests: returns a fixed raw object, records inputs. */
export function makeFakeRecapGenerator(raw: unknown): RecapGenerator & {
  calls: { instruction: string; script: string }[];
} {
  const calls: { instruction: string; script: string }[] = [];
  const gen = (async (instruction: string, script: string) => {
    calls.push({ instruction, script });
    return raw;
  }) as RecapGenerator & { calls: typeof calls };
  gen.calls = calls;
  return gen;
}
