/** Case board: pinned evidence cards and the deductions they unlock. */
import { h, renderRich, richToPlain, tkButton, tkCard, tkIcon, tkStamp } from '@tikshuv/ui';
import type { App } from '../app';
import { DEDUCTIONS, EVIDENCE } from '../catalog';
import { t } from '../i18n';
import type { Screen } from '../router';

export function boardScreen(app: App): Screen {
  app.setMood('mood_hub');
  const held = new Set(app.save.evidence);
  const ids = Object.keys(EVIDENCE);

  /* evidence */
  const evGrid = h('ul', { class: 'cf-board__grid' });
  ids.forEach((id, i) => {
    const ev = EVIDENCE[id]!;
    const li = h('li', {});
    if (held.has(id)) {
      const card = tkCard({
        kind: 'index',
        eyebrow: t('board.evidence.n', { n: String(i + 1).padStart(2, '0') }),
        title: richToPlain(ev.title),
        level: 3,
        body: h('span', {}, renderRich(ev.body)),
        pinned: true,
        tilt: i % 2 === 0 ? -1.5 : 1.5,
      });
      card.querySelector('.tk-card__title')?.replaceChildren(renderRich(ev.title));
      li.appendChild(card);
    } else {
      li.appendChild(
        h('div', { class: 'cf-slotcard' }, tkIcon('lock', { size: 22 }), h('span', {}, t('board.evidence.missing', { n: i + 1 }))),
      );
    }
    evGrid.appendChild(li);
  });

  /* deductions */
  const dedGrid = h('ul', { class: 'cf-board__grid cf-board__grid--ded' });
  for (const [id, d] of Object.entries(DEDUCTIONS)) {
    const missing = d.requires.filter((r) => !held.has(r)).length;
    const li = h('li', {});
    if (missing === 0) {
      li.appendChild(
        tkCard({
          kind: 'memo',
          eyebrow: t('board.deduction'),
          title: d.title,
          level: 3,
          body: h('span', {}, renderRich(d.text)),
          footer: h(
            'span',
            { class: 'cf-ded__req' },
            tkStamp({ text: t('board.deduction.ok'), tone: 'teal', icon: 'check', size: 'sm', angle: -4 }),
            h('span', { class: 'cf-ded__list' }, d.requires.map((r) => richToPlain(EVIDENCE[r]?.title ?? r)).join(' + ')),
          ),
        }),
      );
    } else {
      li.appendChild(
        tkCard({
          kind: 'panel',
          eyebrow: t('board.deduction'),
          title: t('board.deduction.locked'),
          level: 3,
          body: h('span', {}, t('board.deduction.need', { n: missing })),
          footer: h('span', { class: 'cf-lock' }, tkIcon('lock', { size: 18 }), h('span', { class: 'tk-sr-only' }, id)),
        }),
      );
    }
    dedGrid.appendChild(li);
  }

  const el = h(
    'div',
    { class: 'cf-board' },
    h('p', { class: 'cf-hint' }, t('board.intro')),
    h('section', { class: 'cf-board__col', 'aria-labelledby': 'cf-b-ev' },
      h('h2', { class: 'cf-h2', id: 'cf-b-ev' }, t('board.evidence', { n: held.size, total: ids.length })),
      evGrid),
    h('section', { class: 'cf-board__col', 'aria-labelledby': 'cf-b-ded' },
      h('h2', { class: 'cf-h2', id: 'cf-b-ded' }, t('board.deductions')),
      dedGrid),
    h('div', { class: 'cf-board__foot' }, tkButton({ label: t('nav.hub'), variant: 'secondary', onClick: () => app.router.go('hub') })),
  );
  return { el };
}
