import type { LearningTraitId, SubjectKind } from './domain';

/** Status of a live voice session, surfaced to the browser. */
export type VoiceStatus = 'live' | 'resuming' | 'ended';

/** Error codes the relay (or client) can raise. */
export type VoiceErrorCode = 'mic-denied' | 'gemini-unavailable' | 'connection-lost';

/** Browser → relay control messages. Audio is sent separately as binary frames. */
export type ClientControl =
  | { type: 'start'; subjectKind: SubjectKind; topic: string; title: string }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'end' };

/** Relay → browser control messages. Audio is sent separately as binary frames. */
export type ServerControl =
  | { type: 'ready' }
  | { type: 'transcript'; role: 'pip' | 'child'; text: string; final: boolean }
  | { type: 'interrupted' }
  | { type: 'status'; state: VoiceStatus }
  | { type: 'error'; code: VoiceErrorCode; message: string };

/** Learning-style signal Pip emits via function calling. */
export type LearningSignalStrength = 'weak' | 'strong';
export interface LearningSignal {
  trait: LearningTraitId;
  strength: LearningSignalStrength;
}
