import { cx, h, prefersReducedMotion, renderRich, richToPlain, uiText } from './dom';
import { tkIcon } from './icons';
import { tkVoiceTag } from './voice-tag';
import type { VoiceId } from './voices';

export type BubbleKind = 'line' | 'narration' | 'voice';

export interface BubbleOptions {
  kind?: BubbleKind;
  /** Rich text: Hebrew with <ltr>...</ltr> islands and <code> inside them. */
  text: string;
  /** Display name for kind 'line'. */
  speaker?: string;
  mood?: 'neutral' | 'worried' | 'relieved' | 'sly';
  /** Kind 'voice': which inner voice speaks, and its level (0 = muted, shows the ellipsis). */
  voice?: VoiceId;
  voiceLevel?: number;
  /** Characters per second. Default: --tk-typewriter-cps (40; 0 under reduced motion). */
  cps?: number;
  /** Start typing automatically once mounted. Default true. */
  autoplay?: boolean;
  /** Show the continue chevron when the text is fully revealed. Default true. */
  continueHint?: boolean;
  onDone?: () => void;
}

export interface BubbleHandle {
  el: HTMLElement;
  /** Restart the typewriter from the first character. */
  play(): void;
  /** Reveal everything now (tap / Enter / Space). */
  skip(): void;
  readonly finished: boolean;
}

const PAUSE_AFTER: Record<string, number> = { ',': 3, '.': 7, '?': 7, '!': 7, ':': 4, ';': 4 };

/**
 * Dialogue bubble with a typewriter reveal.
 * Layout is stable from frame one: an invisible full copy reserves the final box; the visible copy types on top.
 * Screen readers get the full sentence once (sr-only copy); both visual copies are aria-hidden.
 */
export function tkBubble(o: BubbleOptions): BubbleHandle {
  const kind = o.kind ?? 'line';
  const muted = kind === 'voice' && (o.voiceLevel ?? 1) <= 0;
  const text = muted ? '…' : o.text;

  const ghost = h('span', { class: 'tk-bubble__ghost', 'aria-hidden': 'true' }, renderRich(text));
  const typed = h('span', { class: 'tk-bubble__typed', 'aria-hidden': 'true' }, renderRich(text));
  const sr = h('span', { class: 'tk-sr-only' }, richToPlain(text) + (muted ? ` ${uiText('tk.voice.muted')}` : ''));
  const more = h('span', { class: 'tk-bubble__more', 'aria-hidden': 'true' }, tkIcon('chevron', { size: 18, flipRtl: false }));

  const header =
    kind === 'line' && o.speaker
      ? h('span', { class: 'tk-bubble__speaker' }, o.speaker)
      : kind === 'voice' && o.voice
        ? h('span', { class: 'tk-bubble__voice' }, tkVoiceTag({ voice: o.voice, level: o.voiceLevel ?? 1, hideLevelLabel: true }))
        : null;

  const el = h(
    'div',
    {
      class: cx('tk-bubble', `tk-bubble--${kind}`, muted && 'is-muted', o.mood && `tk-bubble--${o.mood}`),
      'data-voice': kind === 'voice' ? o.voice : undefined,
    },
    header,
    h('p', { class: 'tk-bubble__text' }, sr, h('span', { class: 'tk-bubble__stack' }, ghost, typed)),
    o.continueHint === false ? null : more,
  );

  // Collect the visible text nodes once; typing = filling them back in order.
  const nodes: Array<{ node: Text; full: string }> = [];
  const walker = document.createTreeWalker(typed, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push({ node: n as Text, full: (n as Text).data });
  const total = nodes.reduce((s, x) => s + x.full.length, 0);
  // Per-character time budget including punctuation pauses, so the reveal breathes like speech.
  const plain = nodes.map((x) => x.full).join('');
  const weights: number[] = [];
  let acc = 0;
  for (let i = 0; i < plain.length; i++) {
    acc += 1; // weights[i] = budget (in char-times) at which character i appears
    weights.push(acc);
    acc += PAUSE_AFTER[plain[i]!] ?? 0;
  }

  let raf = 0;
  let finished = false;
  let shown = -1;

  const render = (count: number) => {
    if (count === shown) return;
    shown = count;
    let left = count;
    for (const x of nodes) {
      const take = Math.max(0, Math.min(x.full.length, left));
      x.node.data = x.full.slice(0, take);
      left -= take;
    }
  };
  const finish = () => {
    cancelAnimationFrame(raf);
    render(total);
    if (!finished) {
      finished = true;
      el.classList.add('is-done');
      o.onDone?.();
    }
  };

  const play = () => {
    cancelAnimationFrame(raf);
    finished = false;
    el.classList.remove('is-done');
    const start = () => {
      if (!el.isConnected) {
        raf = requestAnimationFrame(start);
        return;
      }
      const cssCps = Number.parseFloat(getComputedStyle(el).getPropertyValue('--tk-typewriter-cps'));
      const cps = prefersReducedMotion() ? 0 : (o.cps ?? (Number.isFinite(cssCps) ? cssCps : 40));
      if (cps <= 0 || total === 0) return finish();
      render(0);
      const t0 = performance.now();
      const tick = (now: number) => {
        const budget = ((now - t0) / 1000) * cps;
        let count = 0;
        while (count < total && (weights[count] ?? Infinity) <= budget) count++;
        render(count);
        if (count >= total) finish();
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(start);
  };

  el.addEventListener('click', () => {
    if (!finished) finish();
  });

  const handle: BubbleHandle = {
    el,
    play,
    skip: finish,
    get finished() {
      return finished;
    },
  };
  if (o.autoplay !== false) play();
  else finish();
  return handle;
}
