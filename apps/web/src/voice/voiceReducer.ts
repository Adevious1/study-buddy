import type { ServerControl, VoiceErrorCode, VoiceStatus } from '@study-buddy/shared';

export interface Turn {
  role: 'pip' | 'child';
  text: string;
  /** Whether this turn has been finalized. Gemini sends transcripts as incremental
   *  deltas; an open turn accumulates them, a finalized one starts the next fresh. */
  final: boolean;
}
export interface VoiceState {
  status: 'idle' | 'connecting' | VoiceStatus;
  turns: Turn[];
  error: VoiceErrorCode | null;
}

export const initialVoiceState: VoiceState = { status: 'idle', turns: [], error: null };

export type VoiceAction =
  | { kind: 'server'; msg: ServerControl }
  | { kind: 'connecting' };

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  if (action.kind === 'connecting') return { ...state, status: 'connecting', error: null };
  const msg = action.msg;
  switch (msg.type) {
    case 'ready':
      return { ...state, status: 'live', error: null };
    case 'status':
      return { ...state, status: msg.state };
    case 'error':
      return { ...state, error: msg.code };
    case 'interrupted':
      return state;
    case 'transcript': {
      // Gemini streams transcripts as incremental deltas. Append each delta to the
      // current open turn for that role; once a turn is finalized (or the role
      // switches), the next delta begins a new turn.
      const turns = [...state.turns];
      const last = turns[turns.length - 1];
      if (last && last.role === msg.role && !last.final) {
        turns[turns.length - 1] = { role: msg.role, text: last.text + msg.text, final: msg.final };
      } else {
        turns.push({ role: msg.role, text: msg.text, final: msg.final });
      }
      // keep a rolling window (the transcript panel is scrollable)
      return { ...state, turns: turns.slice(-30) };
    }
    default:
      return state;
  }
}
