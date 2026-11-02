import type { SoundKind, TerminalBackend } from './backend';
import { complete, parseHelpRequest, splitOutput } from './completion';
import { History } from './history';

export type LineKind = 'input' | 'output' | 'list' | 'help' | 'info';

export interface OutputLine {
  id: number;
  kind: LineKind;
  text: string;
  /** For `input` lines: the prompt shown before the text. */
  prompt?: string;
}

export type SessionEvent =
  | { type: 'line'; line: OutputLine }
  | { type: 'clear' }
  | { type: 'input'; text: string }
  | { type: 'exit' }
  | { type: 'busy'; busy: boolean };

export interface SessionOptions {
  maxLines?: number;
  maxHistory?: number;
  onCommand?: (line: string, result: { output: string; clear?: boolean; exit?: boolean }) => void;
  onSound?: (kind: SoundKind) => void;
}

/** Headless terminal state machine: scrollback, input text, history, completion, help, execution. */
export class TerminalSession {
  readonly history: History;
  private buffer: OutputLine[] = [];
  private text = '';
  private nextId = 1;
  private listeners = new Set<(e: SessionEvent) => void>();
  private ended = false;
  private running = false;

  constructor(
    readonly backend: TerminalBackend,
    private readonly opts: SessionOptions = {},
  ) {
    this.history = new History(opts.maxHistory ?? 200);
  }

  get lines(): readonly OutputLine[] {
    return this.buffer;
  }
  get input(): string {
    return this.text;
  }
  get exited(): boolean {
    return this.ended;
  }
  get busy(): boolean {
    return this.running;
  }

  subscribe(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** User edited the input field. */
  setInput(text: string): void {
    this.text = text;
    this.history.resetNavigation();
    this.emit({ type: 'input', text });
  }

  /** Append text (banner, hints). Lines are text only. */
  print(text: string, kind: LineKind = 'output'): void {
    for (const t of splitOutput(text)) this.addLine(kind, t);
  }

  historyUp(): void {
    this.text = this.history.up(this.text);
    this.emit({ type: 'input', text: this.text });
  }

  historyDown(): void {
    this.text = this.history.down(this.text);
    this.emit({ type: 'input', text: this.text });
  }

  tab(): void {
    if (this.ended || this.running) return;
    const res = complete(this.text, this.backend.complete(this.text));
    this.sound('tab');
    if (res.kind === 'none') return;
    this.text = res.line;
    this.emit({ type: 'input', text: this.text });
    if (res.kind === 'multiple') {
      this.addLine('input', this.text, this.backend.prompt());
      this.addLine('list', res.candidates.join('  '));
    }
  }

  /** `?` inline help. Returns true when the input ended with `?` (the `?` is stripped). */
  help(): boolean {
    const partial = parseHelpRequest(this.text);
    if (partial === null) return false;
    this.addLine('input', this.text, this.backend.prompt());
    for (const entry of this.backend.help(partial)) this.addLine('help', entry);
    this.text = partial;
    this.emit({ type: 'input', text: partial });
    return true;
  }

  clear(): void {
    this.buffer = [];
    this.sound('clear');
    this.emit({ type: 'clear' });
  }

  /** Run `line` (default: the current input). */
  async submit(line: string = this.text): Promise<void> {
    if (this.ended || this.running) return;
    if (parseHelpRequest(line) !== null) {
      this.text = line;
      this.help();
      return;
    }
    this.sound('enter');
    this.addLine('input', line, this.backend.prompt());
    this.history.push(line);
    this.text = '';
    this.emit({ type: 'input', text: '' });
    if (!line.trim()) return;
    this.running = true;
    this.emit({ type: 'busy', busy: true });
    try {
      const result = await this.backend.execute(line);
      if (result.clear) this.clear();
      for (const t of splitOutput(result.output)) this.addLine('output', t);
      if (result.output) this.sound('output');
      this.opts.onCommand?.(line, result);
      if (result.exit) {
        this.ended = true;
        this.emit({ type: 'exit' });
      }
    } finally {
      this.running = false;
      this.emit({ type: 'busy', busy: false });
    }
  }

  private addLine(kind: LineKind, text: string, prompt?: string): void {
    const line: OutputLine = { id: this.nextId++, kind, text, ...(prompt !== undefined ? { prompt } : {}) };
    this.buffer.push(line);
    const max = this.opts.maxLines ?? 500;
    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
    this.emit({ type: 'line', line });
  }

  private sound(kind: SoundKind): void {
    this.opts.onSound?.(kind);
  }

  private emit(e: SessionEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
