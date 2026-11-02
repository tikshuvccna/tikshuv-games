import { cx, h, prefersReducedMotion } from './dom';
import { tkIcon, type IconName } from './icons';

export type StampTone = 'rust' | 'brass' | 'teal' | 'ink' | 'blue';

export interface StampOptions {
  text: string;
  /** Second line (date, case number), typewriter face. */
  sub?: string;
  tone?: StampTone;
  /** Meaning is never colour-only: red checks always carry an icon (02 section 3.2). */
  icon?: IconName;
  /** Rotation in degrees. Default -7. */
  angle?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Play the "thunk" on mount (skipped under reduced motion). */
  animate?: boolean;
}

export function tkStamp(o: StampOptions): HTMLElement {
  const el = h(
    'span',
    {
      class: cx('tk-stamp', `tk-stamp--${o.tone ?? 'rust'}`, `tk-stamp--${o.size ?? 'md'}`),
      style: `--tk-stamp-angle:${o.angle ?? -7}deg`,
      role: 'img',
      'aria-label': o.sub ? `${o.text}, ${o.sub}` : o.text,
    },
    h(
      'span',
      { class: 'tk-stamp__inner', 'aria-hidden': 'true' },
      o.icon ? tkIcon(o.icon, { size: o.size === 'lg' ? 30 : o.size === 'sm' ? 16 : 22 }) : null,
      h('span', { class: 'tk-stamp__text' }, o.text),
    ),
    o.sub ? h('span', { class: 'tk-stamp__sub', 'aria-hidden': 'true' }, o.sub) : null,
  );
  if (o.animate) stampThunk(el);
  return el;
}

/** Replays the stamp landing animation (scale 1.3 -> 1 with overshoot, ink bleed). */
export function stampThunk(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  el.classList.remove('is-landing');
  void el.offsetWidth; // restart the CSS animation
  el.classList.add('is-landing');
}
