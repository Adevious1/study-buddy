/**
 * Pure transcript cleanups for Pip's output. Kept side-effect-free (no DB,
 * no network) so it is trivially unit-testable, unlike the relay it feeds.
 */

/**
 * Remove a stray leading "Text " token that Gemini's native-audio output
 * transcription sometimes emits at the start of a turn (e.g. "Text That's it!").
 * Only a capitalized standalone "Text " at the very start is stripped, so a
 * sentence that genuinely begins with the word "text" is left alone.
 */
export function stripTextArtifact(s: string): string {
  return s.replace(/^Text (?=\S)/, '');
}
