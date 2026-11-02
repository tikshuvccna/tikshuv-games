/** Codex: glossary entries that unlock as evidence and thoughts are found. */
import { h, ltr, renderRich, tkCard, tkIcon } from '@tikshuv/ui';
import type { App } from '../app';
import { CODEX, type CodexDef } from '../catalog';
import { t } from '../i18n';
import { plain, richCardTitle } from '../rich';
import type { Screen } from '../router';

function unlocked(app: App, e: CodexDef): boolean {
  if (e.unlock === 'start') return true;
  if (e.unlock === 'locked') return false;
  const s = app.save;
  return s.evidence.includes(e.unlock) || (s.thoughts[e.unlock] !== undefined && s.thoughts[e.unlock]!.state !== 'locked');
}

export function codexScreen(app: App): Screen {
  app.setMood('mood_hub');
  const input = h('input', { id: 'cf-codex-q', class: 'cf-input', type: 'search', placeholder: t('codex.search.placeholder'), autocomplete: 'off' });
  const list = h('ul', { class: 'cf-codex__list' });
  const count = h('p', { class: 'cf-hint', 'aria-live': 'polite' });

  const paint = (): void => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren();
    let shown = 0;
    const open = CODEX.filter((e) => unlocked(app, e));
    for (const e of CODEX) {
      const isOpen = unlocked(app, e);
      if (q && (!isOpen || !`${e.term} ${e.en}`.toLowerCase().includes(q))) continue;
      shown++;
      const li = h('li', {});
      if (isOpen) {
        const card = tkCard({
          kind: 'index',
          eyebrow: t('codex.unit', { unit: plain(app.unitTitle(e.unit)) }),
          title: e.term,
          level: 3,
          body: h('span', {}, renderRich(e.def)),
          footer: h('span', { class: 'cf-codex__en' }, ltr(e.en)),
        });
        richCardTitle(card, e.term);
        li.appendChild(card);
      } else {
        li.appendChild(h('div', { class: 'cf-slotcard' }, tkIcon('lock', { size: 22 }), h('span', {}, t('codex.locked', { unit: plain(app.unitTitle(e.unit)) }))));
      }
      list.appendChild(li);
    }
    count.textContent = q ? t('codex.found', { n: shown }) : t('codex.count', { n: open.length, total: CODEX.length });
    if (!shown) list.appendChild(h('li', { class: 'cf-hint' }, t('codex.none')));
  };
  input.addEventListener('input', paint);
  paint();

  const el = h(
    'div',
    { class: 'cf-codex' },
    h('div', { class: 'cf-field cf-field--stack' }, h('label', { for: 'cf-codex-q' }, t('codex.search')), input),
    count,
    list,
  );
  return { el };
}
