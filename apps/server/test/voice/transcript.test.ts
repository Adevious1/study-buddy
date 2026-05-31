import { describe, it, expect } from 'bun:test';
import { stripTextArtifact } from '../../src/voice/transcript';
import { TranscriptAccumulator } from '../../src/voice/transcript';

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

describe('TranscriptAccumulator', () => {
  it('folds incremental deltas of the same role into one turn', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'If 12 ', false);
    acc.add('pip', 'apples', true);
    expect(acc.turns()).toEqual([{ role: 'pip', text: 'If 12 apples' }]);
  });

  it('starts a new turn when the role switches', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'How many?', true);
    acc.add('child', 'is it 8?', true);
    expect(acc.turns()).toEqual([
      { role: 'pip', text: 'How many?' },
      { role: 'child', text: 'is it 8?' },
    ]);
  });

  it('starts a new turn after a turn is finalized even for the same role', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', 'First.', true);
    acc.add('pip', 'Second.', true);
    expect(acc.turns()).toEqual([
      { role: 'pip', text: 'First.' },
      { role: 'pip', text: 'Second.' },
    ]);
  });

  it('includes an open (not-yet-final) turn in its snapshot', () => {
    const acc = new TranscriptAccumulator();
    acc.add('child', 'um', false);
    expect(acc.turns()).toEqual([{ role: 'child', text: 'um' }]);
  });

  it('ignores empty deltas', () => {
    const acc = new TranscriptAccumulator();
    acc.add('pip', '', false);
    expect(acc.turns()).toEqual([]);
  });
});
