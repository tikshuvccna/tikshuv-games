import { holds, type CondEnv } from './condition.js';
import { interpolate } from './interpolate.js';
import { resolveCheck, type CheckResult } from './checks.js';
import type { DialogueNode, DialogueScene, NodeOf, VoiceId } from './schema.js';

export type ExternalKind = 'terminal' | 'quiz' | 'inspect';
export type ExternalOutcome = 'done' | 'giveUp' | 'right' | 'wrong';

export type DialogueEvent =
  | { type: 'enter'; nodeId: string }
  | { type: 'flag'; flag: string; value: boolean | number }
  | { type: 'evidence'; id: string }
  | { type: 'thought'; id: string }
  | { type: 'check'; nodeId: string; color: 'white' | 'red'; result: CheckResult; locked: boolean }
  | { type: 'bail'; nodeId: string }
  | { type: 'choice'; nodeId: string; index: number }
  | { type: 'external'; nodeId: string; kind: ExternalKind; payload: Record<string, string> }
  | { type: 'externalResult'; nodeId: string; kind: ExternalKind; outcome: ExternalOutcome }
  | { type: 'end'; result?: string; unlock?: string };

export interface RunnerOptions {
  name?: string;
  voices?: Partial<Record<VoiceId, number>>;
  flags?: Record<string, boolean | number>;
  evidence?: string[];
  /** thoughts the player knows (condition `thought:id`) */
  thoughts?: string[];
  /** thoughts that are internalised (active); only these give the check thoughtBonus */
  internalised?: string[];
  /** thought id to its tags, for the check thoughtBonus */
  thoughtTags?: Record<string, readonly string[]>;
  /** seed recorded red-check outcomes (so a reload cannot re-roll them) */
  redResults?: Record<string, boolean>;
  /** speaker display-name lookup (nameKey to text); defaults to the nameKey */
  t?: (key: string) => string;
  /** a listener that throws is reported here and never leaves the runner half-advanced */
  onListenerError?: (err: unknown) => void;
}

export interface View {
  id: string;
  type: 'line' | 'narration' | 'voice' | 'choice' | 'check' | 'external' | 'end';
  node: DialogueNode;
  text?: string;
  /** display name for lines (translated nameKey) and for voice nodes (t('voice.<id>')) */
  speaker?: string;
  /** voice nodes: the raw voice id */
  voice?: VoiceId;
  mood?: string;
  /** voice node whose level is too low: shown muted */
  locked?: boolean;
  options?: { index: number; text: string; available: boolean }[];
  /** check preview: every term of the score; call confirm() or bail() */
  check?: { color: 'white' | 'red'; result: CheckResult; canBail: boolean };
  /** terminal / quiz / inspect: hand control to an external component, then resolveExternal() */
  external?: { kind: ExternalKind; payload: Record<string, string> };
}

export interface DialogueState {
  nodeId: string | null;
  flags: Record<string, boolean | number>;
  visited: string[];
  used: string[];
  voices: Partial<Record<VoiceId, number>>;
  evidence: string[];
  thoughts: string[];
  modifiers: Partial<Record<VoiceId, number>>;
  redResults: Record<string, boolean>;
  ended: boolean;
}

/**
 * Resume point (spec 02 section 8.3): the player goes back to the last beat start, i.e. the node
 * the runner is paused on. Evidence, thoughts and voice levels live in the save itself and are
 * passed to the runner via RunnerOptions; the snapshot carries only the runner's own state.
 * Structurally identical to `SaveV1['dialogue']`.
 */
export interface DialogueSnapshot {
  sceneId: string;
  nodeId: string;
  flags: Record<string, boolean | number>;
  visited: string[];
  used: string[];
  redResults: Record<string, boolean>;
  modifiers: Partial<Record<VoiceId, number>>;
  inspected: string[];
  reasoning: Record<string, boolean>;
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
  private internalised: Set<string>;
  private thoughtTags: Record<string, readonly string[]>;
  private modifiers: Partial<Record<VoiceId, number>> = {};
  private redResults = new Map<string, boolean>();
  private used = new Set<string>();
  private inspected = new Set<string>();
  private reasoning = new Map<string, boolean>();
  private listeners = new Set<(e: DialogueEvent) => void>();
  private ended = false;
  private onListenerError: (err: unknown) => void;
  name: string;
  private t: (key: string) => string;

  constructor(opts: RunnerOptions = {}) {
    this.name = opts.name ?? 'חניך';
    this.voices = { ...opts.voices };
    this.flags = { ...opts.flags };
    this.evidence = new Set(opts.evidence);
    this.thoughts = new Set(opts.thoughts);
    this.internalised = new Set(opts.internalised);
    this.thoughtTags = { ...opts.thoughtTags };
    this.seedRed = { ...opts.redResults };
    this.t = opts.t ?? ((k) => k);
    this.onListenerError = opts.onListenerError ?? ((e) => console.error('dialogue listener threw', e));
  }
  /** red outcomes handed in by the constructor; applied by start()/restore() */
  private seedRed: Record<string, boolean>;

  on(fn: (e: DialogueEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: DialogueEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }

  private load(scene: DialogueScene): void {
    this.scene = scene;
    this.nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  }

  start(scene: DialogueScene): View {
    this.load(scene);
    // a fresh start is a clean slate for everything scoped to the scene (M7)
    this.visited.clear();
    this.used.clear();
    this.inspected.clear();
    this.reasoning.clear();
    this.modifiers = {};
    this.redResults = new Map(Object.entries(this.seedRed));
    this.seedRed = {};
    this.ended = false;
    this.settle(scene.start);
    return this.mustCurrent();
  }

  /** Where to resume after a reload. Valid whenever a scene is loaded. */
  snapshot(): DialogueSnapshot {
    if (!this.scene || this.currentId === null) throw new Error('dialogue not started');
    return {
      sceneId: this.scene.id,
      nodeId: this.currentId,
      flags: { ...this.flags },
      visited: [...this.visited],
      used: [...this.used],
      redResults: Object.fromEntries(this.redResults),
      modifiers: { ...this.modifiers },
      inspected: [...this.inspected],
      reasoning: Object.fromEntries(this.reasoning),
    };
  }

  /**
   * Put the player back on the snapshot's node without replaying effects. A recorded red check
   * is never re-rolled: its stored outcome is replayed.
   */
  restore(scene: DialogueScene, snap: DialogueSnapshot): View {
    if (snap.sceneId !== scene.id) throw new Error(`snapshot is for scene "${snap.sceneId}", not "${scene.id}"`);
    this.load(scene);
    const node = this.nodes.get(snap.nodeId);
    if (!node) throw new Error(`snapshot node "${snap.nodeId}" no longer exists in scene "${scene.id}"`);
    this.flags = { ...snap.flags };
    this.visited = new Set(snap.visited);
    this.used = new Set(snap.used);
    this.redResults = new Map(Object.entries(snap.redResults));
    this.modifiers = { ...snap.modifiers };
    this.inspected = new Set(snap.inspected);
    this.reasoning = new Map(Object.entries(snap.reasoning));
    this.seedRed = {};
    this.currentId = node.id;
    this.ended = node.type === 'end';
    if (node.type === 'check' && node.color === 'red' && this.redResults.has(node.id)) this.settle(node.id);
    return this.mustCurrent();
  }

  get state(): DialogueState {
    return {
      nodeId: this.currentId,
      flags: { ...this.flags },
      visited: [...this.visited],
      used: [...this.used],
      voices: { ...this.voices },
      evidence: [...this.evidence],
      thoughts: [...this.thoughts],
      modifiers: { ...this.modifiers },
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
  clearModifiers(): void {
    this.modifiers = {};
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
  /** Mark a thought as internalised (active) and record its tags for the check thoughtBonus. */
  setInternalised(id: string, tags?: readonly string[]): void {
    this.internalised.add(id);
    if (tags) this.thoughtTags[id] = tags;
  }
  removeInternalised(id: string): void {
    this.internalised.delete(id);
  }
  /** Record the answer to a check's show-your-reasoning micro-question (applyBonus +2 when right). */
  answerReasoning(questionId: string, correct: boolean): void {
    this.reasoning.set(questionId, correct);
  }

  private env(): CondEnv {
    return { flags: this.flags, voices: this.voices, evidence: this.evidence, thoughts: this.thoughts };
  }

  current(): View | null {
    if (this.currentId === null) return null;
    const node = this.nodes.get(this.currentId);
    if (!node) return null;
    const fill = (s: string) => interpolate(s, { name: this.name });
    const view: View = { id: node.id, type: 'end', node };
    switch (node.type) {
      case 'line': {
        view.type = 'line';
        view.text = fill(node.text);
        const sp = this.scene?.speakers[node.speaker];
        view.speaker = sp ? this.t(sp.nameKey) : node.speaker;
        if (node.mood) view.mood = node.mood;
        break;
      }
      case 'narration':
        view.type = 'narration';
        view.text = fill(node.text);
        break;
      case 'voice': {
        view.type = 'voice';
        const locked = (this.voices[node.voice] ?? 0) < node.minLevel;
        view.locked = locked;
        view.text = locked ? '…' : fill(node.text);
        view.voice = node.voice;
        view.speaker = this.t(`voice.${node.voice}`);
        if (node.mood) view.mood = node.mood;
        break;
      }
      case 'choice':
        view.type = 'choice';
        view.options = node.options.map((o, index) => ({
          index,
          text: fill(o.text),
          available: this.optionAvailable(node, index),
        }));
        break;
      case 'check':
        view.type = 'check';
        view.check = { color: node.color, result: this.score(node), canBail: node.onBail !== undefined };
        break;
      case 'terminal':
        view.type = 'external';
        view.external = { kind: 'terminal', payload: { deviceId: node.deviceId, goal: node.goal } };
        break;
      case 'quiz':
        view.type = 'external';
        view.external = { kind: 'quiz', payload: { questionId: node.questionId } };
        break;
      case 'inspect':
        view.type = 'external';
        view.external = { kind: 'inspect', payload: { evidenceId: node.evidenceId } };
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
    if (node.type === 'check') throw new Error('check node: use confirm() or bail()');
    if (node.type === 'terminal' || node.type === 'quiz' || node.type === 'inspect') {
      throw new Error(`${node.type} node: use resolveExternal(outcome)`);
    }
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

  /** Lock in the previewed check. Red checks record their outcome (one attempt). */
  confirm(): View {
    const node = this.requireNode();
    if (node.type !== 'check') throw new Error('current node is not a check');
    const result = this.score(node);
    if (node.color === 'red') this.redResults.set(node.id, result.passed);
    this.emit({ type: 'check', nodeId: node.id, color: node.color, result, locked: false });
    this.settle(result.passed ? node.onPass : node.onFail);
    return this.mustCurrent();
  }

  /** "לא עכשיו": leave the check without spending the attempt. Needs `onBail` on the node. */
  bail(): View {
    const node = this.requireNode();
    if (node.type !== 'check') throw new Error('current node is not a check');
    if (!node.onBail) throw new Error(`check ${node.id} has no onBail`);
    this.emit({ type: 'bail', nodeId: node.id });
    this.settle(node.onBail);
    return this.mustCurrent();
  }

  /**
   * Resume after a terminal / quiz / inspect hand-off.
   * terminal: done | giveUp; quiz: right | wrong; inspect: done (also grants the evidence).
   */
  resolveExternal(outcome: ExternalOutcome): View {
    const node = this.requireNode();
    let kind: ExternalKind;
    let next: string | undefined;
    switch (node.type) {
      case 'terminal':
        kind = 'terminal';
        if (outcome !== 'done' && outcome !== 'giveUp') throw new Error(`terminal outcome must be done|giveUp, got ${outcome}`);
        next = outcome === 'done' ? node.onDone : node.onGiveUp;
        break;
      case 'quiz':
        kind = 'quiz';
        if (outcome !== 'right' && outcome !== 'wrong') throw new Error(`quiz outcome must be right|wrong, got ${outcome}`);
        next = outcome === 'right' ? node.onRight : node.onWrong;
        break;
      case 'inspect':
        kind = 'inspect';
        if (outcome !== 'done') throw new Error(`inspect outcome must be done, got ${outcome}`);
        next = node.next;
        break;
      default:
        throw new Error('current node is not an external hand-off');
    }
    this.emit({ type: 'externalResult', nodeId: node.id, kind, outcome });
    if (node.type === 'inspect') {
      this.inspected.add(node.evidenceId);
      this.grantEvidence(node.evidenceId);
    }
    if (!next) throw new Error(`node ${node.id} has no next`);
    this.settle(next);
    return this.mustCurrent();
  }

  private requireNode(): DialogueNode {
    const n = this.currentId === null ? undefined : this.nodes.get(this.currentId);
    if (!n) throw new Error('dialogue not started');
    return n;
  }

  /** Walk automatic nodes until a node that needs the player (or an external component). */
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
        case 'terminal':
          this.emit({ type: 'external', nodeId: id, kind: 'terminal', payload: { deviceId: node.deviceId, goal: node.goal } });
          return;
        case 'quiz':
          this.emit({ type: 'external', nodeId: id, kind: 'quiz', payload: { questionId: node.questionId } });
          return;
        case 'inspect':
          this.emit({ type: 'external', nodeId: id, kind: 'inspect', payload: { evidenceId: node.evidenceId } });
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
            // single attempt: replay the recorded outcome silently, no preview, no re-roll
            this.emit({ type: 'check', nodeId: node.id, color: 'red', result: this.score(node), locked: true });
            id = prior ? node.onPass : node.onFail;
            break;
          }
          return; // preview: the player confirms or bails
        }
      }
    }
    throw new Error('dialogue loop guard tripped (automatic nodes cycle)');
  }

  private score(node: NodeOf<'check'>): CheckResult {
    const tagged = new Set(node.tags);
    const thoughtMatches = [...this.internalised].filter((id) => (this.thoughtTags[id] ?? []).some((t) => tagged.has(t))).length;
    return resolveCheck(node, {
      voiceLevel: this.voices[node.voice] ?? 0,
      modifiers: this.modifiers[node.voice] ?? 0,
      evidenceHeld: node.evidence.filter((e) => this.evidence.has(e)).length,
      thoughtMatches,
      applied: node.reasoning !== undefined && this.reasoning.get(node.reasoning) === true,
      overreach: node.mustInspect.some((e) => !this.inspected.has(e)),
    });
  }
}
