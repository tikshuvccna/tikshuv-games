/**
 * Minimal SVG icon set (24x24 viewBox, 1.5 stroke, currentColor). No emoji anywhere in UI.
 * The full ~60 icon sprite is task A4; it must keep this grid, stroke and naming.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Each icon is a list of SVG child markup strings drawn with stroke=currentColor, fill=none. */
const ICONS = {
  // Voice sigils (02 section 2.4)
  logic: '<rect x="9" y="2.75" width="6" height="4.5" rx="1"/><rect x="2.75" y="16.75" width="6" height="4.5" rx="1"/><rect x="15.25" y="16.75" width="6" height="4.5" rx="1"/><path d="M12 7.25v4.25M5.75 16.75V14a2.5 2.5 0 0 1 2.5-2.5h7.5a2.5 2.5 0 0 1 2.5 2.5v2.75"/>',
  packet_sense: '<rect x="2.75" y="8.75" width="12.5" height="9.5" rx="1.25"/><path d="m2.95 9.4 6.05 4.6 6.05-4.6"/><path d="M17.5 7.5a4 4 0 0 1 0 5.66M19.6 5.4a7 7 0 0 1 0 9.9"/>',
  patience: '<path d="M6.5 2.75h11M6.5 21.25h11"/><path d="M7.75 2.75v2.5c0 2.6 4.25 4.4 4.25 6.75s-4.25 4.15-4.25 6.75v2.5M16.25 2.75v2.5c0 2.6-4.25 4.4-4.25 6.75s4.25 4.15 4.25 6.75v2.5"/><path d="M9.6 19.5c.6-1.4 1.6-2.1 2.4-2.1s1.8.7 2.4 2.1z" fill="currentColor" stroke="none"/>',
  suspicion: '<path d="M2.5 12.5c2.6-3.4 5.8-5 9.5-5s6.9 1.6 9.5 5c-2.6 2.6-5.8 3.75-9.5 3.75S5.1 15.1 2.5 12.5z"/><path d="M3.5 9.5 9 10.4M20.5 9.5 15 10.4"/><circle cx="12" cy="12.4" r="2.1" fill="currentColor" stroke="none"/>',
  recall: '<rect x="2.75" y="5.25" width="18.5" height="13.5" rx="1"/><path d="M2.75 9h18.5"/><path d="M6 12.5h9M6 15.5h6"/><path d="M17.5 5.25V3.5"/>',
  command_line: '<rect x="2.75" y="4.25" width="18.5" height="15.5" rx="1.75"/><path d="m6.5 9.5 3 2.5-3 2.5M11.5 15h5"/>',
  // UI
  check: '<path d="m4.5 12.5 4.75 4.75L19.5 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9.25"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r="1" fill="currentColor" stroke="none"/>',
  warning: '<path d="M10.4 3.9 2.6 17.8A1.8 1.8 0 0 0 4.2 20.5h15.6a1.8 1.8 0 0 0 1.6-2.7L13.6 3.9a1.8 1.8 0 0 0-3.2 0z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  stamp: '<path d="M9.5 3.25h5a1.5 1.5 0 0 1 1.5 1.5c0 2-1.75 3.25-1.75 5.5v1.5h3.5a2 2 0 0 1 2 2v2.5H4.25v-2.5a2 2 0 0 1 2-2h3.5v-1.5C9.75 8 8 6.75 8 4.75a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M5 20.75h14"/>',
  coin: '<circle cx="12" cy="12" r="8.75"/><circle cx="12" cy="12" r="5.75"/><path d="M12 9v6"/>',
  watch: '<circle cx="12" cy="13.5" r="7.75"/><path d="M12 13.5V9.5M12 13.5l2.75 1.75"/><path d="M10 2.75h4M12 2.75v3"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  /** "forward": points right in LTR, auto-mirrored to point left in RTL. */
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  cabinet: '<rect x="3.75" y="2.75" width="16.5" height="18.5" rx="1.25"/><path d="M3.75 12h16.5"/><path d="M10 7.25h4M10 16.5h4"/>',
  lock: '<rect x="4.75" y="10.25" width="14.5" height="10.5" rx="1.5"/><path d="M8 10.25V7.5a4 4 0 0 1 8 0v2.75"/><path d="M12 14.5v2.5"/>',
  hint: '<path d="M9 17.25h6M10 20.75h4"/><path d="M8.6 14.5A6.25 6.25 0 1 1 15.4 14.5c-.6.5-.9 1.1-.9 1.8v.95h-5v-.95c0-.7-.3-1.3-.9-1.8z"/>',
  evidence: '<circle cx="10.5" cy="10.5" r="6.25"/><path d="m15.2 15.2 5.55 5.55"/><path d="M8 10.5a2.5 2.5 0 0 1 2.5-2.5"/>',
  play: '<path d="M7.5 5.5v13l10-6.5z"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1"/><path d="M17.75 3.5v3.75H14M6.25 20.5v-3.75H10"/>',
  star: '<path d="m12 3.25 2.65 5.6 6.1.75-4.5 4.2 1.15 6.05L12 16.9l-5.4 2.95 1.15-6.05-4.5-4.2 6.1-.75z"/>',
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconOptions {
  /** Accessible name. Omit for decorative icons (aria-hidden). */
  label?: string;
  size?: number;
  /** Mirror in RTL (directional glyphs like chevron/play). Default: true for chevron and play. */
  flipRtl?: boolean;
  className?: string;
}

export function tkIcon(name: IconName, o: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const size = o.size ?? 24;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');
  const flip = o.flipRtl ?? (name === 'chevron' || name === 'play');
  svg.setAttribute('class', ['tk-icon', flip ? 'tk-icon--flip' : '', o.className ?? ''].filter(Boolean).join(' '));
  svg.dataset.icon = name;
  if (o.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  // Static, trusted markup from the table above (no user input reaches innerHTML).
  svg.innerHTML = ICONS[name];
  return svg;
}
