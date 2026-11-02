import './terminal.css';
import type { SoundKind, TerminalBackend } from './backend';
import { revealSlice } from './completion';
import { TerminalSession, type OutputLine, type SessionOptions } from './session';

export interface TerminalOptions extends Omit<SessionOptions, 'onSound'> {
  onSound?: (kind: SoundKind) => void;
  /** Accessible name of the log region. */
  label?: string;
  /** Suggested commands shown as tappable chips (they fill and run the command). */
  chips?: string[];
  /** Typewriter reveal of output lines. Off by default; `skip` disables it at any time. */
  reveal?: { charsPerSecond?: number; skip?: boolean };
  /** Lines printed (as `info`) on mount. */
  banner?: string;
}

export interface TerminalHandle {
  readonly element: HTMLElement;
  readonly session: TerminalSession;
  focus(): void;
  setChips(chips: string[]): void;
  /** Finish any running typewriter reveal immediately. */
  skipReveal(): void;
  destroy(): void;
}

const TICK_MS = 30;

/** Mounts the terminal widget into `container`. DOM only; all behaviour lives in TerminalSession. */
export function mountTerminal(container: HTMLElement, backend: TerminalBackend, opts: TerminalOptions = {}): TerminalHandle {
  const doc = container.ownerDocument;
  const session = new TerminalSession(backend, opts);
  const emitSound = (k: SoundKind) => opts.onSound?.(k);

  const root = doc.createElement('div');
  root.className = 'tkt';
  root.dir = 'ltr';

  const log = doc.createElement('div');
  log.className = 'tkt__log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');
  log.setAttribute('aria-label', opts.label ?? 'Terminal output');
  log.tabIndex = 0;

  const row = doc.createElement('div');
  row.className = 'tkt__row';
  const rowPrompt = doc.createElement('span');
  rowPrompt.className = 'tkt__row-prompt';
  rowPrompt.setAttribute('aria-hidden', 'true');
  const input = doc.createElement('input');
  input.className = 'tkt__input';
  input.type = 'text';
  input.dir = 'ltr';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('aria-label', 'Command');
  row.append(rowPrompt, input);

  const chipRow = doc.createElement('div');
  chipRow.className = 'tkt__chips';
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Suggested commands');

  root.append(log, row, chipRow);
  container.appendChild(root);

  /* ---- typewriter reveal ---- */
  const pending: Array<{ el: HTMLElement; text: string; shown: number }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scroll = () => {
    log.scrollTop = log.scrollHeight;
  };
  const finishAll = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const p of pending) p.el.textContent = p.text;
    pending.length = 0;
    log.setAttribute('aria-busy', 'false');
    scroll();
  };
  const tick = () => {
    timer = undefined;
    const cur = pending[0];
    if (!cur) {
      log.setAttribute('aria-busy', 'false');
      return;
    }
    const cps = opts.reveal?.charsPerSecond ?? 400;
    cur.shown = revealSlice(cur.text, cur.shown, (cps * TICK_MS) / 1000);
    cur.el.textContent = cur.text.slice(0, cur.shown);
    emitSound('key');
    scroll();
    if (cur.shown >= cur.text.length) pending.shift();
    timer = setTimeout(tick, TICK_MS);
  };

  const addLine = (line: OutputLine) => {
    const el = doc.createElement('div');
    el.className = `tkt__line tkt__line--${line.kind}`;
    if (line.kind === 'input') {
      const p = doc.createElement('span');
      p.className = 'tkt__prompt';
      p.textContent = line.prompt ?? '';
      el.append(p, doc.createTextNode(line.text));
    } else if (opts.reveal && !opts.reveal.skip && line.kind === 'output' && line.text) {
      pending.push({ el, text: line.text, shown: 0 });
      log.setAttribute('aria-busy', 'true');
      if (timer === undefined) timer = setTimeout(tick, TICK_MS);
    } else {
      el.textContent = line.text;
    }
    log.appendChild(el);
    scroll();
  };

  const refreshPrompt = () => {
    rowPrompt.textContent = backend.prompt() + ' ';
  };

  const setChips = (chips: string[]) => {
    chipRow.replaceChildren();
    for (const c of chips) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'tkt__chip';
      b.textContent = c;
      b.addEventListener('click', () => {
        finishAll();
        void run(c);
      });
      chipRow.appendChild(b);
    }
  };

  const run = async (line: string) => {
    await session.submit(line);
    refreshPrompt();
    input.focus();
  };

  const unsub = session.subscribe((e) => {
    switch (e.type) {
      case 'line':
        addLine(e.line);
        break;
      case 'clear':
        finishAll();
        log.replaceChildren();
        break;
      case 'input':
        if (input.value !== e.text) input.value = e.text;
        break;
      case 'exit':
        input.disabled = true;
        break;
      case 'busy':
        root.toggleAttribute('data-busy', e.busy);
        break;
    }
  });

  /* ---- input handling ---- */
  let escaped = false;
  input.addEventListener('input', () => {
    session.setInput(input.value);
    emitSound('key');
  });
  input.addEventListener('keydown', (ev) => {
    const wasEscaped = escaped;
    escaped = false;
    if (ev.key === 'Escape') {
      escaped = true; // next Tab leaves the terminal (no keyboard trap)
      finishAll();
      return;
    }
    if (ev.key === 'Tab' && wasEscaped) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finishAll();
      void run(input.value);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      session.historyUp();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      session.historyDown();
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      session.tab();
    } else if (ev.key === '?' && !ev.ctrlKey && !ev.metaKey) {
      // inline help without inserting the character
      ev.preventDefault();
      session.setInput(input.value + '?');
      session.help();
    } else if (ev.key === 'l' && ev.ctrlKey) {
      ev.preventDefault();
      session.clear();
    }
  });
  // Clicking the output focuses the input, unless the user is selecting text to copy.
  log.addEventListener('click', () => {
    if (!doc.getSelection()?.toString()) input.focus();
  });

  refreshPrompt();
  if (opts.chips) setChips(opts.chips);
  if (opts.banner) session.print(opts.banner, 'info');

  return {
    element: root,
    session,
    focus: () => input.focus(),
    setChips,
    skipReveal: finishAll,
    destroy: () => {
      finishAll();
      unsub();
      root.remove();
    },
  };
}
