import { h, ltr, tkButton, tkCard, tkStamp, uiText } from '@tikshuv/ui';
import type { AnswerValue, Question } from './schema.js';
import type { QuestionView, QuizSession, QuizSummary, SubmitResult } from './session.js';

/** Thin DOM layer. Only textContent / text nodes are used (no innerHTML). Logic lives in session.ts. */

export interface QuizStrings {
  submit: string;
  hint: string;
  next: string;
  finish: string;
  correct: string;
  wrong: string;
  retry: string;
  revealed: string;
  why: string;
  yes: string;
  no: string;
  moveUp: string;
  moveDown: string;
  pickMatch: string;
  question: string;
  points: string;
  passed: string;
  failed: string;
}

/** Defaults come from the ui string table (key `quiz.*`) so a game can override them via setUiStrings. */
const STRING_KEYS: QuizStrings = {
  submit: 'quiz.submit', hint: 'quiz.hint', next: 'quiz.next', finish: 'quiz.finish', correct: 'quiz.correct',
  wrong: 'quiz.wrong', retry: 'quiz.retry', revealed: 'quiz.revealed', why: 'quiz.why', yes: 'quiz.true',
  no: 'quiz.false', moveUp: 'quiz.moveUp', moveDown: 'quiz.moveDown', pickMatch: 'quiz.pickMatch',
  question: 'quiz.question', points: 'quiz.points', passed: 'quiz.passed', failed: 'quiz.failed',
};
const FALLBACK_HE: QuizStrings = {
  submit: 'שלחו תשובה', hint: 'רמז (מוריד 30% מהניקוד)', next: 'לשאלה הבאה', finish: 'לסיכום', correct: 'נכון',
  wrong: 'לא מדויק', retry: 'נסו שוב: הניקוד יהיה חצי', revealed: 'התשובה הנכונה סומנה', why: 'למה?', yes: 'נכון',
  no: 'לא נכון', moveUp: 'הזיזו למעלה', moveDown: 'הזיזו למטה', pickMatch: 'בחרו התאמה', question: 'שאלה',
  points: 'נקודות', passed: 'עברתם', failed: 'עוד לא',
};

export function resolveStrings(over?: Partial<QuizStrings>): QuizStrings {
  const out = { ...FALLBACK_HE };
  for (const k of Object.keys(STRING_KEYS) as (keyof QuizStrings)[]) {
    const v = uiText(STRING_KEYS[k]);
    if (v !== STRING_KEYS[k]) out[k] = v;
  }
  return { ...out, ...over };
}

export interface RenderOptions {
  /** i18n resolver for promptKey / hintKey / whyKey and non-literal option text. */
  t: (key: string) => string;
  onSubmit: (value: AnswerValue) => void;
  /** Called when the hint button is pressed; return the hint key (e.g. `session.useHint()`). */
  onHint?: () => string | undefined;
  /** Interrogation framing: who is asking (e.g. a voice/character name). */
  speaker?: { label: string; voice?: string };
  strings?: Partial<QuizStrings>;
}

export interface QuestionHandle {
  /** Show feedback + why (aria-live polite). Pass the right answer UI state through `revealed`. */
  showResult(r: SubmitResult): void;
  lock(): void;
  destroy(): void;
}

let uid = 0;
const nid = (p: string): string => `${p}-${++uid}`;

function token(text: string, literal?: boolean, t?: (k: string) => string): Node {
  return literal ? ltr(text) : document.createTextNode(t ? t(text) : text);
}

function buildInput(view: QuestionView, o: RenderOptions, s: QuizStrings): { el: HTMLElement; get: () => AnswerValue; lock: () => void } {
  const q: Question = view.question;
  const group = h('div', { class: 'tk-quiz__answers', role: q.kind === 'multi' ? 'group' : q.kind === 'mcq' || q.kind === 'tf' ? 'radiogroup' : undefined });
  const name = nid('tk-quiz-q');
  const lockers: Array<() => void> = [];

  const choice = (type: 'radio' | 'checkbox', value: string, label: Node): HTMLInputElement => {
    const input = h('input', { type, name, value, class: 'tk-quiz__input' });
    const lab = h('label', { class: 'tk-btn tk-btn--choice tk-quiz__choice' }, input, h('span', { class: 'tk-btn__label' }, label));
    group.appendChild(lab);
    lockers.push(() => (input.disabled = true));
    return input;
  };

  switch (q.kind) {
    case 'mcq':
    case 'multi': {
      const type = q.kind === 'mcq' ? 'radio' : 'checkbox';
      const byId = new Map(q.payload.options.map((x) => [x.id, x]));
      const inputs = view.displayOrder.map((oid) => {
        const opt = byId.get(oid);
        return choice(type, oid, opt ? token(opt.text, opt.literal, o.t) : document.createTextNode(oid));
      });
      return {
        el: group,
        lock: () => lockers.forEach((f) => f()),
        get: () => (q.kind === 'mcq' ? (inputs.find((i) => i.checked)?.value ?? '') : inputs.filter((i) => i.checked).map((i) => i.value)),
      };
    }
    case 'tf': {
      const yes = choice('radio', 'true', document.createTextNode(s.yes));
      choice('radio', 'false', document.createTextNode(s.no));
      return {
        el: group,
        lock: () => lockers.forEach((f) => f()),
        get: () => {
          const checked = group.querySelector<HTMLInputElement>('input:checked');
          void yes;
          return checked ? checked.value === 'true' : '';
        },
      };
    }
    case 'order': {
      let ids = [...view.displayOrder];
      const items = new Map(q.payload.items.map((x) => [x.id, x]));
      const list = h('ol', { class: 'tk-quiz__order' });
      let locked = false;
      const draw = (focusId?: string, focusDir?: 'up' | 'down'): void => {
        list.textContent = '';
        ids.forEach((iid, i) => {
          const it = items.get(iid);
          const mk = (dir: 'up' | 'down', delta: number): HTMLButtonElement =>
            tkButton({
              label: dir === 'up' ? s.moveUp : s.moveDown,
              iconOnly: true,
              variant: 'ghost',
              disabled: locked || i + delta < 0 || i + delta >= ids.length,
              onClick: () => {
                const next = [...ids];
                const a = next[i] as string;
                next[i] = next[i + delta] as string;
                next[i + delta] = a;
                ids = next;
                draw(iid, dir);
              },
            });
          const up = mk('up', -1);
          const down = mk('down', 1);
          // iconOnly buttons render no label: put a visible arrow glyph (decorative; aria-label carries the name)
          up.appendChild(h('span', { 'aria-hidden': 'true' }, '↑'));
          down.appendChild(h('span', { 'aria-hidden': 'true' }, '↓'));
          list.appendChild(h('li', { class: 'tk-quiz__order-item' }, h('span', { class: 'tk-quiz__order-text' }, it ? token(it.text, it.literal, o.t) : iid), up, down));
        });
        if (focusId) {
          const idx = ids.indexOf(focusId);
          const li = list.children[idx];
          const btns = li?.querySelectorAll('button');
          const target = focusDir === 'up' ? btns?.[0] : btns?.[1];
          (target && !target.disabled ? target : btns?.[0])?.focus();
        }
      };
      draw();
      group.appendChild(list);
      return {
        el: group,
        get: () => ids,
        lock: () => {
          locked = true;
          draw();
        },
      };
    }
    case 'match': {
      const rights = new Map(q.payload.pairs.map((p) => [p.id, p]));
      const selects: Array<[string, HTMLSelectElement]> = [];
      for (const pid of view.displayOrder) {
        const pair = rights.get(pid);
        if (!pair) continue;
        const sid = nid('tk-quiz-m');
        const sel = h('select', { id: sid, class: 'tk-quiz__select' });
        sel.appendChild(h('option', { value: '' }, s.pickMatch));
        for (const rid of view.rightOrder) {
          const r = rights.get(rid);
          if (r) sel.appendChild(h('option', { value: rid }, r.right));
        }
        selects.push([pid, sel]);
        lockers.push(() => (sel.disabled = true));
        group.appendChild(h('div', { class: 'tk-quiz__match-row' }, h('label', { for: sid }, token(pair.left, pair.literal, o.t)), sel));
      }
      return {
        el: group,
        lock: () => lockers.forEach((f) => f()),
        get: () => Object.fromEntries(selects.map(([pid, sel]) => [pid, sel.value])),
      };
    }
    case 'fill':
    case 'cli': {
      const iid = nid('tk-quiz-f');
      const input = h('input', {
        id: iid, type: 'text', class: 'tk-quiz__text', dir: 'ltr', autocomplete: 'off', spellcheck: 'false',
        autocapitalize: 'off', placeholder: q.kind === 'fill' ? q.payload.placeholder : undefined,
      });
      lockers.push(() => (input.disabled = true));
      group.appendChild(input);
      return { el: group, lock: () => lockers.forEach((f) => f()), get: () => input.value };
    }
  }
}

export function renderQuestion(host: HTMLElement, view: QuestionView, o: RenderOptions): QuestionHandle {
  const s = resolveStrings(o.strings);
  const q = view.question;
  const input = buildInput(view, o, s);
  const live = h('div', { class: 'tk-quiz__feedback', 'aria-live': 'polite', role: 'status' });
  const hintBox = h('p', { class: 'tk-quiz__hint' });
  const prompt = h('p', { class: 'tk-quiz__prompt', id: nid('tk-quiz-p') }, o.t(q.promptKey));
  if (q.promptToken) prompt.append(' ', ltr(q.promptToken, true));
  input.el.setAttribute('aria-labelledby', prompt.id);

  const submit = tkButton({
    label: s.submit,
    variant: 'primary',
    onClick: () => o.onSubmit(input.get()),
  });
  const hintBtn = q.hintKey
    ? tkButton({
        label: s.hint,
        variant: 'ghost',
        onClick: () => {
          const key = o.onHint?.() ?? q.hintKey;
          if (key) hintBox.textContent = o.t(key);
          hintBtn?.setAttribute('disabled', '');
        },
      })
    : null;
  if (hintBtn && view.hintUsed) {
    hintBtn.setAttribute('disabled', '');
    hintBox.textContent = o.t(q.hintKey as string);
  }

  const body = [
    o.speaker ? h('p', { class: 'tk-quiz__speaker', 'data-voice': o.speaker.voice }, o.speaker.label) : null,
    prompt,
    input.el,
    hintBox,
    h('div', { class: 'tk-quiz__actions' }, submit, hintBtn),
    live,
  ];
  const card = tkCard({
    kind: 'folder',
    eyebrow: `${s.question} ${view.index + 1}/${view.total}`,
    body,
  });
  card.classList.add('tk-quiz');
  card.setAttribute('data-kind', q.kind);
  card.setAttribute('data-persona', 'interrogation');
  host.appendChild(card);

  const lock = (): void => {
    input.lock();
    submit.setAttribute('disabled', '');
    hintBtn?.setAttribute('disabled', '');
  };

  return {
    lock,
    showResult(r) {
      live.textContent = '';
      const msg = r.correct ? s.correct : r.revealed ? s.revealed : s.retry;
      live.appendChild(h('p', { class: r.correct ? 'tk-quiz__ok' : 'tk-quiz__bad' }, `${r.correct ? s.correct : s.wrong}. ${msg}`));
      if (r.done) {
        lock();
        if (r.whyKey) live.appendChild(h('p', { class: 'tk-quiz__why' }, h('strong', {}, `${s.why} `), o.t(r.whyKey)));
        live.appendChild(h('p', { class: 'tk-quiz__points' }, `${r.points} ${s.points}`));
      }
    },
    destroy() {
      card.remove();
    },
  };
}

export interface MountOptions extends Omit<RenderOptions, 'onSubmit' | 'onHint'> {
  onFinish: (summary: QuizSummary) => void;
  /** Called after every state change; persist `session.snapshot()` here. */
  onChange?: (session: QuizSession) => void;
}

/** Drives a whole session in `host`. Returns a disposer. */
export function mountQuiz(host: HTMLElement, session: QuizSession, o: MountOptions): () => void {
  const s = resolveStrings(o.strings);
  let handle: QuestionHandle | null = null;
  let nextBtn: HTMLElement | null = null;

  const show = (): void => {
    handle?.destroy();
    nextBtn?.remove();
    nextBtn = null;
    const view = session.current();
    if (!view) {
      const sum = session.summary();
      handle = null;
      host.appendChild(tkStamp({ text: sum.passed ? s.passed : s.failed, sub: `${sum.correctCount}/${sum.total}`, tone: sum.passed ? 'teal' : 'rust', size: 'lg', animate: true }));
      o.onFinish(sum);
      return;
    }
    handle = renderQuestion(host, view, {
      ...o,
      onHint: () => {
        const k = session.useHint();
        o.onChange?.(session);
        return k;
      },
      onSubmit: (value) => {
        const r = session.submit(value);
        handle?.showResult(r);
        o.onChange?.(session);
        if (r.done) {
          nextBtn = tkButton({ label: session.summary().results.length >= view.total ? s.finish : s.next, variant: 'primary', onClick: () => { session.next(); o.onChange?.(session); show(); } });
          host.appendChild(nextBtn);
          nextBtn.focus();
        }
      },
    });
  };
  show();
  return () => {
    handle?.destroy();
    nextBtn?.remove();
  };
}
