import { holds, type CondEnv } from './condition.js';
import { interpolate } from './interpolate.js';
import { resolveCheck, type CheckResult } from './checks.js';
import type { DialogueNode, DialogueScene, NodeOf, VoiceId } from './schema.js';

export type DialogueEvent =
  | { type: 'enter'; nodeId: string }
  | { type: 'flag'; flag: string; value: boolean | number }
  | { type: 'evidence'; id: string }
  | { type: 'thought'; id: string }
  | { type: 'check'; nodeId: string; color: 'white' | 'red'; result: CheckResult; locked: boolean }
  | { type: 'choice'; nodeId: string; index: number }
  | { type: 'end'; result?: string; unlock?: string };

export interface RunnerOptions {
  name?: string;
  voices?: Partial<Record<VoiceId, number>>;
  flags?: Record<string, boolean | number>;
  evidence?: string[];
  thoughts?: string[];
  /** speaker display-name lookup (nameKey to text); defaults to the nameKey */
  t?: (key: string) => string;
}

export interface View {
  id: string;
  type: 'line' | 'narration' | 'voice' | 'choice' | 'end';
  node: DialogueNode;
  text?: string;
  speaker?: string;
  mood?: string;
  /** voice node whose level is too low: shown muted */
  locked?: boolean;
  options?: { index: number; text: string; available: boolean }[];
}

export interface DialogueState {
  flags: Record<string, boolean | number>;
  visited: string[];
  voices: Partial<Record<VoiceId, number>>;
  evidence: string[];
  thoughts: string[];
  redResults: Record<string, boolean>;
  ended: boolean;
}

const MAX_STEPS = 10_000;

export class DialogueRunner {
  private scene: DialogueScene | null = null;
  private nodes = new Map<string, DialogueNode>();
  private currentId: string | null = null;
  private flags: Record<string, boolean | number>;
  private visited = new Set<string>();
  private voices: Partial<Record<VoiceId, number>>;
  private evidence: Set<string>;
  private thoughts: Set<string>;
  private modifiers: Partial<Record<VoiceId, number>> = {};
  private redResults = new Map<string, boolean>();
  private used = new Set<string>();
  private listeners = new Set<(e: DialogueEvent) => void>();
  private ended = false;
  name: string;
  private t: (key: string) => string;

  constructor(opts: RunnerOptions = {}) {
    this.name = opts.name ?? 'חניך';
    this.voices = { ...opts.voices };
    this.flags = { ...opts.flags };
    this.evidence = new Set(opts.evidence);
    this.thoughts = new Set(opts.thoughts);
    this.t = opts.t ?? ((k) => k);
  }

  on(fn: (e: DialogueEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: DialogueEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  start(scene: DialogueScene): View {
    this.scene = scene;
    this.nodes = new Map(scene.nodes.map((n) => [n.id, n]));
    this.visited.clear();
    this.used.clear();
    this.ended = false;
    this.settle(scene.start);
    return this.mustCurrent();
  }

  get state(): DialogueState {
    return {
      flags: { ...this.flags },
      visited: [...this.visited],
      voices: { ...this.voices },
      evidence: [...this.evidence],
      thoughts: [...this.thoughts],
      redResults: Object.fromEntries(this.redResults),
      ended: this.ended,
    };
  }

  setVoiceLevel(v: VoiceId, level: number): void {
    this.voices[v] = level;
  }
  addModifier(v: VoiceId, n: number): void {
    this.modifiers[v] = (this.modifiers[v] ?? 0) + n;
  }
  grantEvidence(id: string): void {
    if (this.evidence.has(id)) return;
    this.evidence.add(id);
    this.emit({ type: 'evidence', id });
  }
  setFlag(flag: string, value: boolean | number = true): void {
    this.flags[flag] = value;
    this.emit({ type: 'flag', flag, value });
  }

  private env(): CondEnv {
    return { flags: this.flags, voices: this.voices, evidence: this.evidence, thoughts: this.thoughts };
  }

  current(): View | null {
    if (this.currentId === null) return null;
    const node = this.nodes.get(this.currentId);
    if (!node) return null;
    const fill = (s: string) => interpolate(s, { name: this.name });
    const view: View = { id: node.id, type: node.type as View['type'], node };
    switch (node.type) {
      case 'line': {
        view.text = fill(node.text);
        const sp = this.scene?.speakers[node.speaker];
        view.speaker = sp ? this.t(sp.nameKey) : node.speaker;
        if (node.mood) view.mood = node.mood;
        break;
      }
      case 'narration':
        view.text = fill(node.text);
        break;
      case 'voice': {
        const locked = (this.voices[node.voice] ?? 0) < node.minLevel;
        view.locked = locked;
        view.text = locked ? '…' : fill(node.text);
        view.speaker = node.voice;
        if (node.mood) view.mood = node.mood;
        break;
      }
      case 'choice':
        view.options = node.options.map((o, index) => ({
          index,
          text: fill(o.text),
          available: this.optionAvailable(node, index),
        }));
        break;
      default:
        break;
    }
    return view;
  }

  private mustCurrent(): View {
    const v = this.current();
    if (!v) throw new Error('dialogue has no current node');
    return v;
  }

  private optionAvailable(node: NodeOf<'choice'>, i: number): boolean {
    const o = node.options[i];
    if (!o) return false;
    if (o.once && this.used.has(`${node.id}#${i}`)) return false;
    return holds(o.requires, this.env());
  }

  /** Move past a line / narration / voice node. */
  advance(): View {
    const node = this.requireNode();
    if (node.type === 'choice') throw new Error('choice node: use choose(i)');
    if (node.type === 'end') throw new Error('dialogue already ended');
    if (!node.next) throw new Error(`node ${node.id} has no next`);
    this.settle(node.next);
    return this.mustCurrent();
  }

  choose(i: number): View {
    const node = this.requireNode();
    if (node.type !== 'choice') throw new Error('current node is not a choice');
    if (!this.optionAvailable(node, i)) throw new Error(`option ${i} is not available`);
    const o = node.options[i]!;
    if (o.once) this.used.add(`${node.id}#${i}`);
    this.emit({ type: 'choice', nodeId: node.id, index: i });
    this.settle(o.next);
    return this.mustCurrent();
  }

  private requireNode(): DialogueNode {
    const n = this.currentId === null ? undefined : this.nodes.get(this.currentId);
    if (!n) throw new Error('dialogue not started');
    return n;
  }

  /** Walk automatic nodes until a node that needs the player. */
  private settle(startId: string): void {
    let id = startId;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
      const node = this.nodes.get(id);
      if (!node) throw new Error(`missing node "${id}"`);
      this.visited.add(id);
      this.currentId = id;
      this.emit({ type: 'enter', nodeId: id });
      const nxt = (n: string | undefined): string => {
        if (!n) throw new Error(`node ${node.id} has no next`);
        return n;
      };
      switch (node.type) {
        case 'line':
        case 'narration':
        case 'voice':
        case 'choice':
          return;
        case 'end':
          this.ended = true;
          this.emit({
            type: 'end',
            ...(node.result ? { result: node.result } : {}),
            ...(node.unlock ? { unlock: node.unlock } : {}),
          });
          return;
        case 'set':
          this.setFlag(node.flag, node.value);
          id = nxt(node.next);
          break;
        case 'goto':
          id = node.target;
          break;
        case 'evidence':
          this.grantEvidence(node.evidenceId);
          id = nxt(node.next);
          break;
        case 'thought':
          if (!this.thoughts.has(node.thoughtId)) {
            this.thoughts.add(node.thoughtId);
            this.emit({ type: 'thought', id: node.thoughtId });
          }
          id = nxt(node.next);
          break;
        case 'branch': {
          const hit = node.cases.find((c) => holds(c.if, this.env()));
          id = hit ? hit.next : node.else;
          break;
        }
        case 'check': {
          const prior = this.redResults.get(node.id);
          if (node.color === 'red' && prior !== undefined) {
            // single attempt: replay the recorded outcome, no re-roll
            this.emit({ type: 'check', nodeId: node.id, color: 'red', result: this.score(node), locked: true });
            id = prior ? node.onPass : node.onFail;
            break;
          }
          const result = this.score(node);
          if (node.color === 'red') this.redResults.set(node.id, result.passed);
          this.emit({ type: 'check', nodeId: node.id, color: node.color, result, locked: false });
          id = result.passed ? node.onPass : node.onFail;
          break;
        }
      }
    }
    throw new Error('dialogue loop guard tripped (automatic nodes cycle)');
  }

  private score(node: NodeOf<'check'>): CheckResult {
    return resolveCheck(node, {
      voiceLevel: this.voices[node.voice] ?? 0,
      modifiers: this.modifiers[node.voice] ?? 0,
      evidenceHeld: node.evidence.filter((e) => this.evidence.has(e)).length,
    });
  }
}
