import { describe, it, expect } from 'bun:test';
import { stripTextArtifact } from '../../src/voice/transcript';

describe('stripTextArtifact', () => {
  it('strips a leading "Text " artifact', () => {
    expect(stripTextArtifact('Text That\'s it! Three chances.')).toBe("That's it! Three chances.");
  });

  it('strips only the first occurrence, not a later "Text"', () => {
    expect(stripTextArtifact('Text read the Text aloud')).toBe('read the Text aloud');
  });

  it('leaves a normal sentence untouched', () => {
    expect(stripTextArtifact('Spot on. So you have three chances.')).toBe('Spot on. So you have three chances.');
  });

  it('does not strip a lowercase "text" word', () => {
    expect(stripTextArtifact('text me the answer')).toBe('text me the answer');
  });

  it('does not strip "Text" when it is part of a larger word', () => {
    expect(stripTextArtifact('Textbook page 4')).toBe('Textbook page 4');
  });

  it('does not strip a trailing-only "Text "', () => {
    expect(stripTextArtifact('Read the Text ')).toBe('Read the Text ');
  });
});
