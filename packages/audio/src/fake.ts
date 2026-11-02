import type { AContextLike } from './types';

export interface ParamCall { kind: 'set' | 'ramp' | 'target' | 'cancel'; value?: number; time: number; tc?: number }

export class FakeParam {
  calls: ParamCall[] = [];
  constructor(public value = 1) {}
  setValueAtTime(v: number, t: number) { this.calls.push({ kind: 'set', value: v, time: t }); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'ramp', value: v, time: t }); return this; }
  setTargetAtTime(v: number, t: number, tc: number) { this.calls.push({ kind: 'target', value: v, time: t, tc }); return this; }
  cancelScheduledValues(t: number) { this.calls.push({ kind: 'cancel', time: t }); return this; }
}

export class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  started: number[] = [];
  stopped: (number | undefined)[] = [];
  type = '';
  loop = false;
  buffer: { duration: number; getChannelData(ch: number): Float32Array } | null = null;
  gain = new FakeParam(1);
  frequency = new FakeParam(440);
  Q = new FakeParam(1);
  constructor(public readonly kind: string) {}
  connect(n: FakeNode) { this.connections.push(n); return n; }
  disconnect() { this.disconnected = true; }
  start(t = 0) { this.started.push(t); }
  stop(t?: number) { this.stopped.push(t); }
}

/** Minimal in-memory AudioContext for tests (no jsdom, no sound). */
export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state = 'suspended';
  destination = new FakeNode('destination');
  nodes: FakeNode[] = [];
  resumeCalls = 0;
  decodeFails = false;
  private mk(kind: string) { const n = new FakeNode(kind); this.nodes.push(n); return n; }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  createGain() { return this.mk('gain'); }
  createBiquadFilter() { return this.mk('filter'); }
  createOscillator() { return this.mk('osc'); }
  createBufferSource() { return this.mk('source'); }
  createBuffer(_ch: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  async decodeAudioData(_d: ArrayBuffer) {
    if (this.decodeFails) throw new Error('decode failed');
    return { duration: 2, getChannelData: () => new Float32Array(1) };
  }
  ofKind(kind: string) { return this.nodes.filter((n) => n.kind === kind); }
  asContext(): AContextLike { return this as unknown as AContextLike; }
}
