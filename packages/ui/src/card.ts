import { cx, h, type Child } from './dom';

export type CardKind = 'index' | 'folder' | 'panel' | 'memo';

export interface CardOptions {
  kind?: CardKind;
  /** Small typewriter label above the title (case number, evidence id...). */
  eyebrow?: string;
  title?: string;
  /** Heading level for the title (document outline). Default 3. */
  level?: 2 | 3 | 4;
  body?: Child | Child[];
  footer?: Child | Child[];
  /** Folder kind: text on the folder tab. */
  tab?: string;
  /** Draw a brass pin at the top (case board). */
  pinned?: boolean;
  /** Slight hand-placed tilt in degrees, clamped to -3..3. Static and decorative (not motion). */
  tilt?: number;
  /** Makes the whole card a single interactive target (renders as <button>). */
  onActivate?: () => void;
}

export function tkCard(o: CardOptions): HTMLElement {
  const kind = o.kind ?? 'index';
  const interactive = typeof o.onActivate === 'function';
  const root = h(interactive ? 'button' : 'article', {
    class: cx('tk-card', `tk-card--${kind}`, o.pinned && 'tk-card--pinned', interactive && 'tk-card--interactive'),
    type: interactive ? 'button' : undefined,
    style: o.tilt ? `--tk-tilt:${Math.max(-3, Math.min(3, o.tilt))}deg` : undefined,
  });
  if (kind === 'folder' && o.tab) root.appendChild(h('span', { class: 'tk-card__tab' }, o.tab));
  if (o.pinned) root.appendChild(h('span', { class: 'tk-card__pin', 'aria-hidden': 'true' }));
  if (o.eyebrow) root.appendChild(h('p', { class: 'tk-card__eyebrow' }, o.eyebrow));
  if (o.title) {
    const tag = interactive ? 'span' : (`h${o.level ?? 3}` as 'h3');
    root.appendChild(h(tag, { class: 'tk-card__title' }, o.title));
  }
  const body = Array.isArray(o.body) ? o.body : [o.body];
  if (o.body !== undefined) root.appendChild(h(interactive ? 'span' : 'div', { class: 'tk-card__body' }, ...body));
  if (o.footer !== undefined) {
    const footer = Array.isArray(o.footer) ? o.footer : [o.footer];
    root.appendChild(h(interactive ? 'span' : 'div', { class: 'tk-card__footer' }, ...footer));
  }
  if (interactive) root.addEventListener('click', () => o.onActivate?.());
  return root;
}
