import he from '../locales/he.json';

/* ---------- strings (i18n seam until @tikshuv/i18n lands, task F4) ---------- */

let dict: Record<string, string> = he;

/** Replace or extend the UI kit strings, e.g. with the game's i18n dictionary. */
export function setUiStrings(next: Record<string, string>): void {
  dict = { ...dict, ...next };
}

export function uiText(key: string): string {
  return dict[key] ?? key;
}

/* ---------- tiny DOM builder ---------- */

export type Child = Node | string | number | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

let uid = 0;
export function nextId(prefix = 'tk'): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function prefersReducedMotion(): boolean {
  if (document.documentElement.hasAttribute('data-calm')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- rich text: Hebrew with LTR islands (02 section 6.1) ---------- */

export interface RichSegment {
  text: string;
  ltr: boolean;
  code: boolean;
}

/**
 * Parses the only markup the dialogue schema allows: <ltr>...</ltr> and <code>...</code> inside it.
 * Everything else, including stray angle brackets, stays literal text (rendered via text nodes: no HTML injection).
 */
export function parseRich(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let ltr = false;
  let code = false;
  let last = 0;
  const re = /<(\/?)(ltr|code)>/g;
  let m: RegExpExecArray | null;
  const push = (s: string) => {
    if (s) out.push({ text: s, ltr, code });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const closing = m[1] === '/';
    if (m[2] === 'ltr') ltr = !closing;
    else code = !closing && ltr; // code is only legal inside an LTR island
    last = re.lastIndex;
  }
  push(text.slice(last));
  return out;
}

/** Renders rich text into nodes. LTR islands become <bdi dir="ltr" class="tk-ltr">. */
export function renderRich(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let island: HTMLElement | null = null;
  for (const seg of parseRich(text)) {
    const textNode = seg.code ? h('code', { class: 'tk-code' }, seg.text) : document.createTextNode(seg.text);
    if (seg.ltr) {
      if (!island) {
        island = h('bdi', { dir: 'ltr', class: 'tk-ltr' });
        frag.appendChild(island);
      }
      island.appendChild(textNode);
    } else {
      island = null;
      frag.appendChild(textNode);
    }
  }
  return frag;
}

/** Plain text of rich markup (for aria-labels and length checks). */
export function richToPlain(text: string): string {
  return parseRich(text).map((s) => s.text).join('');
}

/** Convenience: an LTR island for code-built strings such as IPs, MACs and commands. */
export function ltr(text: string, asCode = false): HTMLElement {
  return h('bdi', { dir: 'ltr', class: 'tk-ltr' }, asCode ? h('code', { class: 'tk-code' }, text) : text);
}
