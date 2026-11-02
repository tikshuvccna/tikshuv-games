import type { IconName } from './icons';
import { uiText } from './dom';

export type VoiceId = 'logic' | 'packet_sense' | 'patience' | 'suspicion' | 'recall' | 'command_line';

export const VOICE_IDS: readonly VoiceId[] = ['logic', 'packet_sense', 'patience', 'suspicion', 'recall', 'command_line'];

export const VOICE_MAX_LEVEL = 5;

/** Icon is the voice sigil; the accent comes from CSS (--tk-voice-<id>), never from TS. */
export const VOICE_ICON: Record<VoiceId, IconName> = {
  logic: 'logic',
  packet_sense: 'packet_sense',
  patience: 'patience',
  suspicion: 'suspicion',
  recall: 'recall',
  command_line: 'command_line',
};

export function voiceName(id: VoiceId): string {
  return uiText(`voice.${id}`);
}

export function voiceLevelLabel(level: number): string {
  const l = Math.max(0, Math.min(VOICE_MAX_LEVEL, Math.round(level)));
  return uiText(`voice.level.${l}`);
}
