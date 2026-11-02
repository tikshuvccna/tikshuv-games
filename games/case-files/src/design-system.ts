/**
 * Design-system story page (task O1). Static showcase of every tk-* component in RTL Hebrew with LTR islands.
 * Dev/review tool only: built as a second Vite input (dist/case-files/design-system.html).
 */
import {
  ICON_NAMES,
  MOODS,
  VOICE_IDS,
  h,
  ltr,
  palette,
  renderRich,
  stampThunk,
  tkBubble,
  tkButton,
  tkCard,
  tkDialog,
  tkIcon,
  tkProgress,
  tkStamp,
  tkTabs,
  tkToast,
  tkToastEl,
  tkVoiceTag,
  type BubbleHandle,
  type Child,
  type VoiceId,
} from '@tikshuv/ui';
import demo from '../content/he/design_system_demo.json';
import './styles/design-system.css';

const S: Record<string, string> = demo;
const t = (k: string): string => S[k] ?? k;
const rich = (k: string): DocumentFragment => renderRich(t(k));

/* ---------------------------------------------------------------- helpers */

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function section(id: string, title: string, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: 'ds-section', id, 'aria-labelledby': `${id}-h` },
    h('h2', { class: 'ds-h2', id: `${id}-h` }, h('span', { class: 'ds-h2__num', dir: 'ltr' }, id.replace('s', '')), title),
    ...children,
  );
}
const row = (...c: Child[]) => h('div', { class: 'ds-row' }, ...c);
const grid = (cls: string, ...c: Child[]) => h('div', { class: `ds-grid ${cls}` }, ...c);
const caption = (text: string) => h('p', { class: 'ds-caption' }, text);
const label = (text: string, ...c: Child[]) => h('figure', { class: 'ds-spec' }, ...c, h('figcaption', { class: 'ds-spec__cap' }, ltr(text)));

/* ------------------------------------------------------------- 1 palette */

function paletteSection(): HTMLElement {
  const night = palette.base.night.hex;
  const ink = palette.base.ink.hex;
  const paper = palette.base.paper.hex;
  const sw = (name: string, hex: string, use: string) => {
    const onDark = contrast(hex, night);
    const fg = lum(hex) > 0.25 ? ink : paper;
    const fgRatio = contrast(hex, fg);
    return h(
      'div',
      { class: 'ds-swatch' },
      h('div', { class: 'ds-swatch__chip', style: `background:var(--cf-${name});color:var(--cf-${fg === ink ? 'ink' : 'paper'})` },
        h('span', { class: `ds-swatch__ratio${fgRatio < 4.5 ? ' is-fill' : ''}`, dir: 'ltr', title: fgRatio < 4.5 ? 'fill / large only' : 'AA text' }, `Aa ${fgRatio.toFixed(1)}`)),
      h('div', { class: 'ds-swatch__meta' },
        h('code', { class: 'ds-swatch__token', dir: 'ltr' }, `--cf-${name}`),
        h('span', { class: 'ds-swatch__hex', dir: 'ltr' }, hex),
        h('span', { class: 'ds-swatch__use', dir: 'ltr' }, use || `vs night ${onDark.toFixed(1)}`)),
    );
  };
  return section(
    's1',
    t('sec.palette'),
    caption(t('sec.palette.note')),
    grid('ds-grid--swatches', ...Object.entries(palette.base).map(([k, v]) => sw(k, v.hex, v.use))),
    grid('ds-grid--swatches ds-grid--tints', ...Object.entries(palette.tints).map(([k, v]) => sw(k, v.hex, ''))),
  );
}

/* ---------------------------------------------------------- 2 typography */

function typeSection(): HTMLElement {
  return section(
    's2',
    t('sec.type'),
    h('div', { class: 'ds-type' },
      label('3xl 800 / --tk-font-sans', h('p', { class: 'ds-type__display' }, t('type.display'))),
      label('xl 800', h('p', { class: 'ds-type__h2' }, t('type.h2'))),
      label('md 400 / leading 1.55 / LTR islands', h('p', { class: 'ds-type__body' }, rich('type.body'))),
      label('sm / --tk-text-muted', h('p', { class: 'ds-type__small' }, t('type.small'))),
      label('--tk-font-type', h('p', { class: 'ds-type__type' }, t('type.typewriter'))),
      label('--tk-font-mono', h('p', { class: 'ds-type__mono' }, ltr(t('type.mono'), true))),
    ),
  );
}

/* -------------------------------------------------------------- 3 tokens */

function tokensSection(): HTMLElement {
  const spaces = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    label(`space-${n}`, h('span', { class: 'ds-space', style: `inline-size:var(--tk-space-${n})` })),
  );
  const radii = ['xs', 'sm', 'md', 'lg', 'pill'].map((r) => label(`radius-${r}`, h('span', { class: 'ds-radius', style: `border-radius:var(--tk-radius-${r})` })));
  const shadows = ['1', 'paper', 'lift', 'inset'].map((s) => label(`shadow-${s}`, h('span', { class: 'ds-shadow', style: `box-shadow:var(--tk-shadow-${s})` })));
  const motion = ['press', 'fast', 'base', 'slow', 'page', 'stamp'].map((d) =>
    label(`dur-${d}`, h('span', { class: 'ds-motion', style: `--d:var(--tk-dur-${d})` }, h('span', { class: 'ds-motion__dot' }))),
  );
  return section(
    's3',
    t('sec.tokens'),
    h('div', { class: 'ds-tokens' }, row(...spaces), row(...radii), row(...shadows), row(...motion)),
  );
}

/* ------------------------------------------------------------- 4 buttons */

function buttonsSection(): HTMLElement {
  const focusDemo = tkButton({ label: t('btn.focus'), variant: 'secondary' });
  focusDemo.classList.add('ds-force-focus');
  return section(
    's4',
    t('sec.buttons'),
    row(
      tkButton({ label: t('btn.primary'), variant: 'primary', icon: 'chevron', iconEnd: true }),
      tkButton({ label: t('btn.secondary'), variant: 'secondary', icon: 'cabinet' }),
      tkButton({ label: t('btn.ghost'), variant: 'ghost' }),
      tkButton({ label: t('btn.danger'), variant: 'danger', icon: 'stamp' }),
      focusDemo,
      tkButton({ label: t('btn.disabled'), variant: 'primary', icon: 'lock', disabled: true }),
    ),
    row(
      tkButton({ label: t('btn.next'), variant: 'primary', size: 'lg', icon: 'play', iconEnd: true }),
      tkButton({ label: t('btn.hint'), variant: 'secondary', icon: 'hint' }),
      tkButton({ label: t('btn.menu'), variant: 'ghost', icon: 'menu', iconOnly: true }),
      tkButton({ label: t('btn.cabinet'), variant: 'secondary', icon: 'cabinet', iconOnly: true }),
      tkButton({ label: t('btn.evidence'), variant: 'secondary', icon: 'evidence', iconOnly: true }),
    ),
    h('div', { class: 'ds-choices' }, ...choiceButtons()),
    h('div', { class: 'tk-on-paper ds-paper-strip' },
      tkButton({ label: t('btn.primary'), variant: 'primary' }),
      tkButton({ label: t('btn.secondary'), variant: 'secondary' }),
      tkButton({ label: t('btn.ghost'), variant: 'ghost' }),
    ),
  );
}

function choiceButtons(): HTMLButtonElement[] {
  return ['choice.1', 'choice.2', 'choice.3'].map((k, i) => {
    const b = tkButton({ label: '', variant: 'choice', keyHint: String(i + 1) });
    b.querySelector('.tk-btn__label')!.replaceChildren(rich(k));
    return b;
  });
}

/* --------------------------------------------------------------- 5 cards */

function cardsSection(): HTMLElement {
  return section(
    's5',
    t('sec.cards'),
    grid(
      'ds-grid--cards',
      tkCard({ kind: 'index', eyebrow: t('card.index.eyebrow'), title: t('card.index.title'), body: h('p', {}, rich('card.index.body')),
        footer: tkStamp({ text: t('stamp.evidence'), tone: 'blue', size: 'sm', icon: 'evidence', angle: -4 }) }),
      tkCard({ kind: 'folder', tab: t('card.folder.tab'), title: t('card.folder.title'), body: h('p', {}, t('card.folder.body')),
        footer: [tkButton({ label: t('btn.primary'), variant: 'primary', icon: 'chevron', iconEnd: true })] }),
      tkCard({ kind: 'memo', eyebrow: t('card.memo.eyebrow'), title: t('card.memo.title'), body: h('p', {}, t('card.memo.body')), tilt: -1.2 }),
      tkCard({ kind: 'panel', eyebrow: t('card.panel.eyebrow'), title: t('card.panel.title'), body: h('p', {}, t('card.panel.body')),
        footer: [tkButton({ label: t('btn.primary'), variant: 'primary', icon: 'play', iconEnd: true })] }),
      tkCard({ kind: 'index', pinned: true, tilt: 2, title: t('card.board.title'), body: t('card.board.body'), onActivate: () => undefined }),
    ),
  );
}

/* -------------------------------------------------------------- 6 dialog */

function checkBody(): HTMLElement {
  return h('div', { class: 'ds-check' },
    h('p', { class: 'ds-check__sum' }, t('dlg.check.sum')),
    h('p', { class: 'ds-check__need' }, t('dlg.check.need')),
    h('div', { class: 'ds-check__voice' }, tkVoiceTag({ voice: 'logic', level: 3 })),
  );
}

function dialogSection(): HTMLElement {
  const inlineCheck = h('dialog', { class: 'tk-dialog tk-dialog--paper tk-dialog--inline', open: true, 'aria-labelledby': 'ds-inline-check' },
    h('header', { class: 'tk-dialog__header' }, h('div', { class: 'tk-dialog__heading' },
      h('p', { class: 'tk-dialog__eyebrow' }, t('dlg.check.eyebrow')),
      h('h3', { class: 'tk-dialog__title', id: 'ds-inline-check' }, t('dlg.check.title')))),
    h('div', { class: 'tk-dialog__body' }, checkBody()),
    h('footer', { class: 'tk-dialog__actions' },
      tkButton({ label: t('dlg.check.go'), variant: 'primary' }),
      tkButton({ label: t('btn.ghost'), variant: 'secondary' })),
  );
  const inlineRed = h('dialog', { class: 'tk-dialog tk-dialog--slate tk-dialog--inline', open: true, 'aria-labelledby': 'ds-inline-red' },
    h('header', { class: 'tk-dialog__header' }, h('div', { class: 'tk-dialog__heading' },
      h('p', { class: 'tk-dialog__eyebrow' }, t('dlg.red.eyebrow')),
      h('h3', { class: 'tk-dialog__title', id: 'ds-inline-red' }, t('dlg.red.title'))),
      tkStamp({ text: t('dlg.red.stamp'), tone: 'rust', icon: 'stamp', size: 'sm', angle: 6 })),
    h('div', { class: 'tk-dialog__body' }, h('p', {}, t('dlg.red.body'))),
    h('footer', { class: 'tk-dialog__actions' },
      tkButton({ label: t('btn.danger'), variant: 'danger', icon: 'stamp' }),
      tkButton({ label: t('btn.ghost'), variant: 'secondary' })),
  );

  const openCheck = () => {
    const d = tkDialog({ tone: 'paper', eyebrow: t('dlg.check.eyebrow'), title: t('dlg.check.title'), body: checkBody(),
      actions: [tkButton({ label: t('dlg.check.go'), variant: 'primary', onClick: () => d.close('go') }),
        tkButton({ label: t('btn.ghost'), variant: 'secondary', onClick: () => d.close('later') })] });
    d.open();
  };
  const openRed = () => {
    const d = tkDialog({ tone: 'slate', eyebrow: t('dlg.red.eyebrow'), title: t('dlg.red.title'), modalLocked: true,
      body: h('p', {}, t('dlg.red.body')),
      actions: [tkButton({ label: t('btn.danger'), variant: 'danger', icon: 'stamp', onClick: () => d.close('go') }),
        tkButton({ label: t('btn.ghost'), variant: 'secondary', onClick: () => d.close('later') })] });
    d.open();
  };
  const openSys = () => {
    const d = tkDialog({ title: t('dlg.sys.title'), body: h('p', {}, t('dlg.sys.body')),
      actions: [tkButton({ label: t('dlg.sys.cancel'), variant: 'primary', onClick: () => d.close() }),
        tkButton({ label: t('dlg.sys.ok'), variant: 'secondary', onClick: () => d.close('exit') })] });
    d.open();
  };
  return section(
    's6',
    t('sec.dialog'),
    grid('ds-grid--two', inlineCheck, inlineRed),
    row(
      tkButton({ label: t('dlg.open.check'), variant: 'secondary', onClick: openCheck }),
      tkButton({ label: t('dlg.open.red'), variant: 'secondary', onClick: openRed }),
      tkButton({ label: t('dlg.open.sys'), variant: 'secondary', onClick: openSys }),
    ),
  );
}

/* --------------------------------------------------------------- 7 toast */

function toastSection(): HTMLElement {
  const stack = h('div', { class: 'ds-toasts' },
    tkToastEl({ tone: 'success', title: t('toast.save'), message: t('toast.save.msg') }),
    tkToastEl({ tone: 'info', icon: 'cabinet', title: t('toast.thought'), message: t('toast.thought.msg') }),
    tkToastEl({ tone: 'reward', message: t('toast.coins') }),
    tkToastEl({ tone: 'warn', icon: 'watch', message: t('toast.warn') }),
    tkToastEl({ tone: 'error', message: t('toast.error') }),
  );
  stack.querySelectorAll('[role]').forEach((el) => el.removeAttribute('role')); // static copies must not announce
  const tones = ['success', 'reward', 'warn', 'error'] as const;
  let n = 0;
  return section(
    's7',
    t('sec.toast'),
    stack,
    row(tkButton({ label: t('toast.show'), variant: 'secondary', icon: 'info', onClick: () => {
      const tone = tones[n++ % tones.length]!;
      const msg = { success: t('toast.save.msg'), reward: t('toast.coins'), warn: t('toast.warn'), error: t('toast.error') }[tone];
      tkToast({ tone, message: msg, timeout: tone === 'error' ? 6000 : undefined });
    } })),
  );
}

/* ---------------------------------------------------------------- 8 tabs */

function tabsSection(): HTMLElement {
  const table = h('table', { class: 'ds-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('tabs.rank')), h('th', { scope: 'col' }, t('tabs.name')), h('th', { scope: 'col' }, t('tabs.score')))),
    h('tbody', {},
      h('tr', {}, h('td', {}, ltr('1')), h('td', {}, t('tabs.row1')), h('td', {}, ltr('980'))),
      h('tr', {}, h('td', {}, ltr('2')), h('td', {}, t('tabs.row2')), h('td', {}, ltr('915'))),
      h('tr', { class: 'is-me' }, h('td', {}, ltr('4')), h('td', {}, t('tabs.row3')), h('td', {}, ltr('720')))),
  );
  return section(
    's8',
    t('sec.tabs'),
    h('div', { class: 'ds-tabs-wrap' }, tkTabs({ label: t('tabs.label'), tabs: [
      { id: 'class', label: t('tabs.class'), panel: table },
      { id: 'week', label: t('tabs.week'), panel: h('p', {}, t('tabs.week.body')) },
      { id: 'me', label: t('tabs.me'), panel: h('p', {}, t('tabs.me.body')) },
    ] })),
  );
}

/* ------------------------------------------------------------ 9 progress */

function progressSection(): HTMLElement {
  const thought = tkProgress({ label: '', value: 130, max: 180, tone: 'teal', valueText: (v, m) => `${fmt(v)} / ${fmt(m)}` });
  thought.el.querySelector('.tk-progress__label')!.replaceChildren(rich('prog.thought'));
  return section(
    's9',
    t('sec.progress'),
    h('div', { class: 'ds-progress' },
      tkProgress({ label: t('prog.case'), value: 3, max: 8, ticks: true }).el,
      tkProgress({ label: t('prog.watch'), value: 612, max: 720, tone: 'amber', valueText: (v) => fmt(v) }).el,
      thought.el,
      tkProgress({ label: t('prog.terminal'), value: 2, max: 3, tone: 'phosphor', ticks: true }).el,
      tkProgress({ label: t('prog.red'), value: 1, max: 3, tone: 'rust', ticks: true }).el,
    ),
  );
}
function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ 10 bubbles */

function bubblesSection(): HTMLElement {
  const handles: BubbleHandle[] = [];
  const add = (b: BubbleHandle) => (handles.push(b), b.el);
  return section(
    's10',
    t('sec.bubble'),
    h('div', { class: 'ds-bubbles' },
      add(tkBubble({ kind: 'narration', text: t('bubble.narration') })),
      add(tkBubble({ kind: 'line', speaker: t('bubble.dana'), mood: 'worried', text: t('bubble.dana.text') })),
      add(tkBubble({ kind: 'voice', voice: 'suspicion', voiceLevel: 2, text: t('bubble.suspicion') })),
      add(tkBubble({ kind: 'line', speaker: t('bubble.rishon'), mood: 'sly', text: t('bubble.rishon.text') })),
      add(tkBubble({ kind: 'voice', voice: 'command_line', voiceLevel: 2, text: t('bubble.cli') })),
      add(tkBubble({ kind: 'voice', voice: 'recall', voiceLevel: 0, text: '' })),
    ),
    row(
      tkButton({ label: t('bubble.replay'), variant: 'secondary', icon: 'refresh', onClick: () => handles.forEach((b) => b.play()) }),
      tkButton({ label: t('bubble.skip'), variant: 'ghost', onClick: () => handles.forEach((b) => b.skip()) }),
    ),
  );
}

/* --------------------------------------------------------- 11 voice tags */

function voicesSection(): HTMLElement {
  const levels: Record<VoiceId, number> = { logic: 3, packet_sense: 2, patience: 1, suspicion: 2, recall: 4, command_line: 5 };
  return section(
    's11',
    t('sec.voice'),
    h('div', { class: 'ds-voices' }, ...VOICE_IDS.map((v) => tkVoiceTag({ voice: v, level: levels[v], progress: v === 'logic' ? 2 : 0 }))),
    h('div', { class: 'ds-voices' }, ...[0, 1, 2, 3, 4, 5].map((l) => tkVoiceTag({ voice: 'packet_sense', level: l }))),
    h('div', { class: 'ds-voices ds-voices--strip' }, ...VOICE_IDS.map((v) => tkVoiceTag({ voice: v, level: levels[v], compact: true, onActivate: () => undefined }))),
  );
}

/* ------------------------------------------------------------- 12 stamps */

function stampsSection(): HTMLElement {
  const make = () => [
    tkStamp({ text: t('stamp.closed'), sub: t('stamp.date'), tone: 'rust', size: 'lg', angle: -8 }),
    tkStamp({ text: t('stamp.red'), tone: 'rust', icon: 'stamp', angle: 5 }),
    tkStamp({ text: t('stamp.white'), tone: 'ink', icon: 'refresh', angle: -3 }),
    tkStamp({ text: t('stamp.nogoing'), tone: 'rust', size: 'sm', angle: -5 }),
    tkStamp({ text: t('stamp.proven'), tone: 'teal', icon: 'check', angle: 4 }),
    tkStamp({ text: t('stamp.evidence'), tone: 'brass', icon: 'evidence', size: 'sm', angle: -2 }),
  ];
  const dark = h('div', { class: 'ds-stamps' }, ...make());
  const paper = h('div', { class: 'ds-stamps tk-on-paper ds-paper' }, ...make());
  return section(
    's12',
    t('sec.stamp'),
    grid('ds-grid--two', dark, paper),
    row(tkButton({ label: t('stamp.replay'), variant: 'secondary', icon: 'stamp', onClick: () =>
      document.querySelectorAll<HTMLElement>('.ds-stamps .tk-stamp').forEach((s, i) => setTimeout(() => stampThunk(s), i * 90)) })),
  );
}

/* ----------------------------------------------------------- 13 terminal */

function terminalSection(): HTMLElement {
  const pre = h('pre', {});
  pre.append(
    'C:\\> arp -a\n',
    h('span', { class: 'dim' }, 'Interface: 192.168.1.10 --- 0x4\n  Internet Address      Physical Address      Type\n'),
    '  192.168.1.20          00-1a-2b-3c-4d-5e     dynamic\n',
    'C:\\> ',
    h('span', { class: 'cursor', 'aria-hidden': 'true' }),
  );
  return section('s13', t('sec.terminal'), h('div', { class: 'tk-terminal', role: 'log', 'aria-label': 'PC-Office' }, pre));
}

/* -------------------------------------------------------- 14 compositions */

function portrait(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 240');
  svg.setAttribute('class', 'ds-portrait');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<defs><linearGradient id="rim" x1="1" x2="0"><stop offset="0" style="stop-color:var(--tk-mood-light);stop-opacity:.9"/><stop offset=".35" style="stop-color:var(--tk-mood-light);stop-opacity:0"/></linearGradient></defs>' +
    '<path d="M100 28c27 0 44 20 44 47 0 20-8 36-20 45l2 14c30 6 52 22 60 52l6 54H8l6-54c8-30 30-46 60-52l2-14c-12-9-20-25-20-45 0-27 17-47 44-47z" style="fill:var(--cf-ink)"/>' +
    '<path d="M100 28c27 0 44 20 44 47 0 20-8 36-20 45l2 14c30 6 52 22 60 52l6 54H8l6-54c8-30 30-46 60-52l2-14c-12-9-20-25-20-45 0-27 17-47 44-47z" fill="url(#rim)" opacity=".55"/>';
  return svg;
}

function topBar(compact: boolean): HTMLElement {
  return h('div', { class: 'ds-topbar' },
    h('span', { class: 'ds-topbar__title' }, compact ? t('layout.caseShort') : t('layout.case')),
    h('span', { class: 'ds-watch' }, tkIcon('watch', { size: 18 }), h('bdi', { dir: 'ltr' }, '03:40')),
    h('span', { class: 'ds-topbar__actions' },
      compact ? null : tkButton({ label: `${t('btn.evidence')} 2`, variant: 'ghost', icon: 'evidence' }),
      compact ? null : tkButton({ label: t('btn.cabinet'), variant: 'ghost', icon: 'cabinet', iconOnly: true }),
      tkButton({ label: t('btn.menu'), variant: 'ghost', icon: 'menu', iconOnly: true })),
  );
}

function scene(compact: boolean): HTMLElement {
  const stage = h('div', { class: 'ds-stage' },
    h('span', { class: 'ds-stage__window', 'aria-hidden': 'true' }),
    h('span', { class: 'ds-stage__lamp', 'aria-hidden': 'true' }),
    portrait(),
    h('button', { type: 'button', class: 'ds-hotspot', style: 'inset-inline-start:18%;inset-block-start:58%', 'aria-label': t('hotspot.printer') }),
    h('button', { type: 'button', class: 'ds-hotspot', style: 'inset-inline-end:16%;inset-block-start:66%', 'aria-label': t('hotspot.cable') }),
  );
  const dialogue = h('div', { class: 'ds-dialogue' },
    tkBubble({ kind: 'line', speaker: t('bubble.dana'), mood: 'worried', text: t('bubble.dana.text') }).el,
    tkBubble({ kind: 'voice', voice: 'suspicion', voiceLevel: 2, text: t('bubble.suspicion'), continueHint: false }).el,
    h('div', { class: 'ds-choices' }, ...choiceButtons()),
  );
  const bottom = compact
    ? h('div', { class: 'ds-actionbar' },
        tkButton({ label: `${t('btn.evidence')} 2`, variant: 'secondary', icon: 'evidence' }),
        tkButton({ label: t('btn.cabinet'), variant: 'secondary', icon: 'cabinet', iconOnly: true }),
        tkButton({ label: t('btn.hint'), variant: 'secondary', icon: 'hint', iconOnly: true }))
    : null;
  return h('div', { class: `ds-scene ${compact ? 'ds-scene--phone' : 'ds-scene--desktop'}`, 'data-mood': 'investigate' }, topBar(compact), stage, dialogue, bottom);
}

function layoutSection(): HTMLElement {
  return section(
    's14',
    t('sec.layout'),
    h('div', { class: 'ds-frames' },
      h('figure', { class: 'ds-frame ds-frame--desktop' }, h('figcaption', { class: 'ds-frame__cap' }, t('layout.desktop')), h('div', { class: 'ds-frame__scroll' }, scene(false))),
      h('figure', { class: 'ds-frame ds-frame--phone' }, h('figcaption', { class: 'ds-frame__cap' }, t('layout.phone')), scene(true)),
    ),
  );
}

/* --------------------------------------------------------------- 15 icons */

function iconsSection(): HTMLElement {
  return section(
    's15',
    t('sec.icons'),
    caption(t('icons.note')),
    h('div', { class: 'ds-icons' }, ...ICON_NAMES.map((n) => h('div', { class: 'ds-icon' }, tkIcon(n, { size: 28 }), h('code', { dir: 'ltr' }, n)))),
  );
}

/* ------------------------------------------------------------------ page */

function header(): HTMLElement {
  const moodButtons = MOODS.map((m) => {
    const b = h('button', { type: 'button', class: 'ds-mood', 'aria-pressed': String(m === 'bureau'), 'data-m': m }, t(`mood.${m}`));
    b.addEventListener('click', () => {
      document.body.dataset.mood = m;
      document.querySelectorAll('.ds-mood').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  });
  const calm = h('input', { type: 'checkbox', id: 'ds-calm' });
  calm.addEventListener('change', () => document.documentElement.toggleAttribute('data-calm', calm.checked));
  return h('header', { class: 'ds-header' },
    h('div', { class: 'ds-header__brand' },
      h('p', { class: 'ds-header__eyebrow' }, ltr('@tikshuv/ui · O1')),
      h('h1', { class: 'ds-h1' }, t('page.title')),
      h('p', { class: 'ds-lede' }, t('page.lede'))),
    tkStamp({ text: 'O1', sub: 'CASE FILES', tone: 'brass', size: 'lg', angle: 8 }),
    h('div', { class: 'ds-controls' },
      h('div', { class: 'ds-moods', role: 'group', 'aria-label': t('page.mood') }, h('span', { class: 'ds-controls__label' }, t('page.mood')), ...moodButtons),
      h('label', { class: 'ds-calm', for: 'ds-calm' }, calm, t('page.calm'))),
  );
}

const app = document.getElementById('ds')!;
app.append(
  header(),
  h('main', { class: 'ds-main' },
    paletteSection(), typeSection(), tokensSection(), buttonsSection(), cardsSection(), dialogSection(), toastSection(),
    tabsSection(), progressSection(), bubblesSection(), voicesSection(), stampsSection(), terminalSection(), layoutSection(), iconsSection()),
);
