import { describe, expect, it } from 'bun:test';
import {
  noteLearningSignalDeclaration, parseLearningSignal, SignalAccumulator,
} from '../../src/voice/tools';
import { offerCameraDeclaration } from '../../src/voice/tools';

describe('noteLearningSignalDeclaration', () => {
  it('is named note_learning_signal with trait + strength params', () => {
    expect(noteLearningSignalDeclaration.name).toBe('note_learning_signal');
    const props = noteLearningSignalDeclaration.parameters?.properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['strength', 'trait']);
  });
});

describe('parseLearningSignal', () => {
  it('accepts a valid trait + strength', () => {
    expect(parseLearningSignal({ trait: 'visual', strength: 'strong' }))
      .toEqual({ trait: 'visual', strength: 'strong' });
  });
  it('rejects unknown trait', () => {
    expect(parseLearningSignal({ trait: 'taste', strength: 'weak' })).toBeNull();
  });
  it('rejects missing strength', () => {
    expect(parseLearningSignal({ trait: 'visual' })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(parseLearningSignal(null)).toBeNull();
    expect(parseLearningSignal('visual')).toBeNull();
  });
});

describe('SignalAccumulator', () => {
  it('collects valid signals and ignores invalid ones via addRaw', () => {
    const acc = new SignalAccumulator();
    expect(acc.addRaw({ trait: 'visual', strength: 'weak' })).toBe(true);
    expect(acc.addRaw({ trait: 'nope', strength: 'weak' })).toBe(false);
    expect(acc.all()).toEqual([{ trait: 'visual', strength: 'weak' }]);
  });
});

describe('offer_camera declaration', () => {
  it('is named offer_camera and takes no required args', () => {
    expect(offerCameraDeclaration.name).toBe('offer_camera');
    expect(offerCameraDeclaration.parameters?.required ?? []).toEqual([]);
  });
});
