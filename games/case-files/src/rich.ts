import { renderRich, richToPlain } from '@tikshuv/ui';

/** Wraps bare Latin technical tokens (MAC, IPv4, tracert, 192.168.1.1) in LTR islands; leaves marked-up text alone. */
export function autoLtr(text: string): string {
  if (/<ltr>/.test(text)) return text;
  return text.replace(/[A-Za-z][A-Za-z0-9]*(?:[.\-:/][A-Za-z0-9]+)*/g, (m) => `<ltr>${m}</ltr>`);
}

/** Plain text of a rich string (for aria-labels and card titles that are rendered afterwards). */
export function plain(text: string): string {
  return richToPlain(autoLtr(text));
}

/** Rich fragment with automatic LTR islands. */
export function rich(text: string): DocumentFragment {
  return renderRich(autoLtr(text));
}

/** Re-renders a tkCard title with LTR islands (tkCard titles are plain text nodes). */
export function richCardTitle(card: HTMLElement, text: string): void {
  card.querySelector('.tk-card__title')?.replaceChildren(rich(text));
}
