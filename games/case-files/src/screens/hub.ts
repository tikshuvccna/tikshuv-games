import { isUnitComplete } from '@tikshuv/save';
import { VOICE_IDS, h, renderRich, tkBubble, tkButton, tkCard, tkIcon, tkStamp, tkToast, tkVoiceTag } from '@tikshuv/ui';
import type { App } from '../app';
import { portraitEl } from '../art';
import { CASES, type CaseDef } from '../catalog';
import { t } from '../i18n';
import { rich, richCardTitle } from '../rich';
import type { Screen } from '../router';

function caseTab(c: CaseDef): string {
  if (c.num === 0) return t('hub.tab.prologue');
  if (c.finale) return t('hub.tab.finale');
  return t('hub.tab.case', { n: c.num });
}

export function hubScreen(app: App): Screen {
  const firstDay = !CASES.some((c) => app.save.cases[c.id]?.solved);
  app.setMood(firstDay ? 'mood_hub_first_day' : 'mood_hub');
  const next = app.nextStep();
  const afterBlackout = app.afterBlackout;
  app.afterBlackout = false;

  /* ---- mentor strip ---- */
  const line = afterBlackout ? t('hub.mentor.blackout') : firstDay ? t('hub.mentor.first') : t('hub.mentor.ready');
  const mentor = h(
    'section',
    { class: 'cf-mentor', 'aria-label': t('cast.rishon') },
    portraitEl('p_rishon', t('cast.rishon')),
    tkBubble({ kind: 'line', speaker: t('cast.rishon'), text: line, continueHint: false, cps: 0 }).el,
  );

  /* ---- CTA ---- */
  const cta = h('div', { class: 'cf-cta' + (afterBlackout ? ' is-highlight' : '') });
  if (next) {
    const label = next.unitId
      ? t('hub.cta.lesson', { unit: app.unitTitle(next.unitId) })
      : next.caseDef.num === 0
        ? t('hub.cta.start', { title: next.caseDef.title })
        : t('hub.cta.case', { title: next.caseDef.title });
    cta.append(
      tkButton({
        label,
        variant: 'primary',
        size: 'lg',
        icon: 'play',
        iconEnd: true,
        block: true,
        onClick: () => openCase(app, next.caseDef),
      }),
    );
    if (afterBlackout) cta.append(h('p', { class: 'cf-cta__hint' }, t('hub.cta.highlight')));
  } else cta.append(h('p', { class: 'cf-cta__hint' }, t('hub.cta.none')));

  /* ---- nav ---- */
  const used = Object.values(app.save.thoughts).filter((x) => x.state === 'internalising' || x.state === 'internalised').length;
  const nav = h(
    'nav',
    { class: 'cf-hub__nav', 'aria-label': t('hub.nav') },
    tkButton({ label: t('nav.board'), icon: 'evidence', onClick: () => app.router.go('board') }),
    tkButton({ label: t('hub.cabinet', { used, slots: app.slots() }), icon: 'cabinet', onClick: () => app.router.go('cabinet') }),
    tkButton({ label: t('nav.codex'), icon: 'recall', onClick: () => app.router.go('codex') }),
    tkButton({ label: t('nav.inspect'), icon: 'hint', onClick: () => app.router.go('inspect/bureau') }),
  );

  /* ---- case list ---- */
  const list = h('ul', { class: 'cf-cases', 'aria-label': t('hub.cases') });
  for (const c of CASES) list.appendChild(h('li', { class: 'cf-cases__item' }, caseCard(app, c, next?.caseDef.id === c.id)));

  /* ---- voices strip ---- */
  const strip = h('section', { class: 'cf-voices', 'aria-label': t('hub.voices') });
  for (const v of VOICE_IDS) {
    const p = app.save.voices[v];
    strip.appendChild(
      tkVoiceTag({
        voice: v,
        level: p?.level ?? 0,
        progress: p?.pips ?? 0,
        compact: window.matchMedia('(max-width: 600px)').matches,
        onActivate: () => app.router.go('cabinet'),
      }),
    );
  }

  const el = h(
    'div',
    { class: 'cf-hub' },
    h('div', { class: 'cf-hub__top' }, mentor, h('div', { class: 'cf-hub__actions' }, cta, nav)),
    h('h2', { class: 'cf-h2' }, t('hub.cases')),
    list,
    strip,
  );
  return { el };
}

function openCase(app: App, c: CaseDef): void {
  if (c.scene && c.playable) {
    app.router.go(`scene/${c.scene}`);
    return;
  }
  tkToast({ message: t('hub.soon', { title: c.title }), tone: 'info', icon: 'info' });
}

function caseCard(app: App, c: CaseDef, isNext: boolean): HTMLElement {
  const status = app.caseStatus(c);
  const units = h('span', { class: 'cf-units' });
  for (const u of c.units) {
    const p = app.save.units[u];
    const done = !!p && isUnitComplete(p);
    units.appendChild(
      h(
        'span',
        { class: done ? 'cf-unit is-done' : 'cf-unit' },
        tkIcon(done ? 'check' : 'chevron', { size: 16 }),
        h('span', {}, rich(app.unitTitle(u))),
        h('span', { class: 'tk-sr-only' }, done ? t('hub.unit.done') : t('hub.unit.todo')),
      ),
    );
  }

  let lockNote: HTMLElement | null = null;
  if (status === 'locked') {
    const need = c.finale ? t('hub.lock.finale') : c.units.length ? t('hub.lock.units') : t('hub.lock.prev');
    lockNote = h('p', { class: 'cf-lock' }, tkIcon('lock', { size: 18 }), h('span', {}, need));
  }
  const footer =
    status === 'solved'
      ? tkStamp({ text: t('result.closed'), tone: 'teal', icon: 'check', size: 'sm', angle: -5 })
      : status === 'open'
        ? h('span', { class: 'cf-state' }, isNext ? t('hub.state.next') : t('hub.state.open'))
        : lockNote;

  const body = [h('span', { class: 'cf-case-place' }, c.place), h('span', {}, renderRich(c.hook)), c.units.length ? units : null];
  const card = tkCard({
    kind: status === 'locked' ? 'panel' : 'folder',
    tab: caseTab(c),
    title: c.title,
    level: 3,
    body,
    footer,
    ...(status === 'locked' ? {} : { onActivate: () => openCase(app, c) }),
  });
  richCardTitle(card, c.title);
  card.classList.add(`cf-case--${status}`);
  if (isNext) card.classList.add('is-next');
  if (status === 'locked') card.setAttribute('aria-disabled', 'true');
  return card;
}
