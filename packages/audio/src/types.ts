/** Minimal structural subset of Web Audio used by this package (real AudioContext satisfies it). */
export interface AParam {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  setTargetAtTime(v: number, t: number, timeConstant: number): unknown;
  cancelScheduledValues(t: number): unknown;
  /** present in modern browsers; avoids a click when a layer is faded out mid-fade-in */
  cancelAndHoldAtTime?(t: number): unknown;
}
export interface ANode {
  connect(dest: ANode): unknown;
  disconnect(): void;
}
export interface AGain extends ANode { gain: AParam }
export interface AFilter extends ANode { type: string; frequency: AParam; Q: AParam }
export interface AOsc extends ANode {
  type: string;
  frequency: AParam;
  start(t?: number): void;
  stop(t?: number): void;
  onended?: (() => void) | null;
}
export interface ABuffer { duration: number; getChannelData(ch: number): Float32Array }
export interface ASource extends ANode {
  buffer: ABuffer | null;
  loop: boolean;
  start(t?: number): void;
  stop(t?: number): void;
  onended?: (() => void) | null;
}
export interface AContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: ANode;
  resume(): Promise<void>;
  suspend?(): Promise<void>;
  /** fires when the context goes running / suspended / interrupted (iOS) */
  onstatechange?: (() => void) | null;
  createGain(): AGain;
  createBiquadFilter(): AFilter;
  createOscillator(): AOsc;
  createBufferSource(): ASource;
  createBuffer(channels: number, length: number, sampleRate: number): ABuffer;
  decodeAudioData(data: ArrayBuffer): Promise<ABuffer>;
}

export type BusName = 'music' | 'sfx' | 'ambience' | 'ui';
export const BUS_NAMES: readonly BusName[] = ['music', 'sfx', 'ambience', 'ui'];

export type SfxName =
  | 'click' | 'confirm' | 'deny' | 'stamp' | 'typewriter' | 'paper'
  | 'notification' | 'check-pass' | 'check-fail' | 'blackout'
  | 'level-up' | 'sparkle' | 'whoosh';
export const SFX_NAMES: readonly SfxName[] = [
  'click', 'confirm', 'deny', 'stamp', 'typewriter', 'paper',
  'notification', 'check-pass', 'check-fail', 'blackout',
  'level-up', 'sparkle', 'whoosh',
];

/** Scene mood ids (VOICE_BIBLE section 5); the single list lives in @tikshuv/core. */
export type { SceneMoodId as MoodId } from '@tikshuv/core';
