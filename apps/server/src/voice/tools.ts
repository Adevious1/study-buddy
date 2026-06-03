import { Type, type FunctionDeclaration } from '@google/genai';
import type {
  LearningSignal, LearningSignalStrength, LearningTraitId,
} from '@study-buddy/shared';

export const noteLearningSignalDeclaration: FunctionDeclaration = {
  name: 'note_learning_signal',
  description:
    'Record that the child responded well to a particular learning approach. ' +
    'Call this whenever you notice it; keep the conversation natural.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      trait: {
        type: Type.STRING,
        enum: ['visual', 'narrative', 'kinesthetic', 'auditory'],
        description: 'Which learning style the child responded to.',
      },
      strength: {
        type: Type.STRING,
        enum: ['weak', 'strong'],
        description: 'How strong the signal was.',
      },
    },
    required: ['trait', 'strength'],
  },
};

export const offerCameraDeclaration: FunctionDeclaration = {
  name: 'offer_camera',
  description:
    'Invite the child to show you a picture of their work (a drawing, worksheet, ' +
    'book page, or real objects) when seeing it would help. This only highlights ' +
    'the camera button for the child — they still tap to take the picture. ' +
    'Keep talking naturally; do not mention the tool.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: 'Optional short note on why a picture would help.',
      },
    },
    required: [],
  },
};

const TRAITS: readonly string[] = ['visual', 'narrative', 'kinesthetic', 'auditory'];
const STRENGTHS: readonly string[] = ['weak', 'strong'];

/** Validate + coerce a raw tool-call arg object into a LearningSignal, or null. */
export function parseLearningSignal(args: unknown): LearningSignal | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a.trait !== 'string' || !TRAITS.includes(a.trait)) return null;
  if (typeof a.strength !== 'string' || !STRENGTHS.includes(a.strength)) return null;
  return {
    trait: a.trait as LearningTraitId,
    strength: a.strength as LearningSignalStrength,
  };
}

/** In-session accumulator for learning signals. */
export class SignalAccumulator {
  private signals: LearningSignal[] = [];
  addRaw(args: unknown): boolean {
    const s = parseLearningSignal(args);
    if (!s) return false;
    this.signals.push(s);
    return true;
  }
  all(): LearningSignal[] {
    return [...this.signals];
  }
}
