import { cx, h, nextId, uiText } from './dom';

export type ProgressTone = 'brass' | 'teal' | 'amber' | 'phosphor' | 'rust';

export interface ProgressOptions {
  label: string;
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Visible value text. Default: "value / max". Rendered as an LTR island. */
  valueText?: (value: number, max: number) => string;
  /** Draw tick marks every N units (e.g. per question). */
  ticks?: boolean;
  /** Hide the label row visually (label stays as the accessible name). */
  compact?: boolean;
}

export interface ProgressHandle {
  el: HTMLElement;
  set(value: number, valueTextOverride?: string): void;
}

export function tkProgress(o: ProgressOptions): ProgressHandle {
  const max = o.max ?? 100;
  const labelId = nextId('tk-prog');
  const fmt = o.valueText ?? ((v: number, m: number) => `${v} / ${m}`);
  const fill = h('span', { class: 'tk-progress__fill' });
  const track = h('span', {
    class: 'tk-progress__track',
    role: 'progressbar',
    'aria-labelledby': labelId,
    'aria-valuemin': 0,
    'aria-valuemax': max,
  }, fill);
  if (o.ticks && max > 1 && max <= 24) {
    track.style.setProperty('--tk-ticks', String(max));
    track.classList.add('tk-progress__track--ticks');
  }
  const valueEl = h('bdi', { class: 'tk-progress__value', dir: 'ltr', 'aria-hidden': 'true' });
  const el = h(
    'div',
    { class: cx('tk-progress', `tk-progress--${o.tone ?? 'brass'}`, o.compact && 'tk-progress--compact') },
    h('div', { class: 'tk-progress__row' }, h('span', { class: 'tk-progress__label', id: labelId }, o.label), valueEl),
    track,
  );
  const handle: ProgressHandle = {
    el,
    set(value, override) {
      const v = Math.max(0, Math.min(max, value));
      fill.style.inlineSize = `${(v / max) * 100}%`;
      const text = override ?? fmt(v, max);
      track.setAttribute('aria-valuenow', String(v));
      track.setAttribute('aria-valuetext', override ?? `${v} ${uiText('tk.of')} ${max}`);
      valueEl.textContent = text;
    },
  };
  handle.set(o.value);
  return handle;
}
