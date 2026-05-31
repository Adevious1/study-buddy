/**
 * Pure transcript cleanups for Pip's output. Kept side-effect-free (no DB,
 * no network) so it is trivially unit-testable, unlike the relay it feeds.
 */
import type { TranscriptTurn } from '@study-buddy/shared';

/**
 * Remove a stray leading "Text " token that Gemini's native-audio output
 * transcription sometimes emits at the start of a turn (e.g. "Text That's it!").
 * Only a capitalized standalone "Text " at the very start is stripped, so a
 * sentence that genuinely begins with the word "text" is left alone.
 */
export function stripTextArtifact(s: string): string {
  return s.replace(/^Text (?=\S)/, '');
}

/**
 * Folds role-tagged transcript deltas (the same stream the relay forwards to the
 * browser) into ordered, finalized turns for persistence and recap generation.
 * Pure and in-memory: one instance per live session. Mirrors the browser
 * voiceReducer's accumulation, but keeps the whole transcript.
 */
export class TranscriptAccumulator {
  private all: TranscriptTurn[] = [];
  private open = false; // whether the last turn is still accumulating deltas

  /** Append a transcript delta. `final` closes the current turn. Empty text is ignored. */
  add(role: 'pip' | 'child', text: string, final: boolean): void {
    if (text.length === 0) {
      if (final) this.open = false;
      return;
    }
    const last = this.all[this.all.length - 1];
    if (this.open && last && last.role === role) {
      last.text += text;
    } else {
      this.all.push({ role, text });
    }
    this.open = !final;
  }

  /** A snapshot of all turns so far (including any still-open turn). */
  turns(): TranscriptTurn[] {
    return this.all.map((t) => ({ ...t }));
  }
}
