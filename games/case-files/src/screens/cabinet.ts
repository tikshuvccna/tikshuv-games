/** Thought Cabinet (spec 02 section 5): six inner voices, slots that cook on active play time, known thoughts. */
import { forgetThought, type ThoughtState } from '@tikshuv/save';
import {
  VOICE_IDS,
  h,
  ltr,
  renderRich,
  richToPlain,
  tkButton,
  tkCard,
  tkDialog,
  tkIcon,
  tkProgress,
  tkToast,
  tkVoiceTag,
  type ProgressHandle,
} from '@tikshuv/ui';
import type { App } from '../app';
import { THOUGHTS, VOICE_ROLES } from '../catalog';
import { t } from '../i18n';
import type { Screen } from '../router';

const MIN = 60_000;
const MAX_SLOTS = 6;
const clock = (ms: number): string => `${Math.floor(ms / MIN)}:${String(Math.floor((ms % MIN) / 1000)).padStart(2, '0')}`;

export function cabinetScreen(app: App): Screen {
  app.setMood('mood_cabinet');
  const root = h('div', { class: 'cf-cabinet' });
  const bars = new Map<string, { bar: ProgressHandle; need: number }>();
  let signature = '';

  const sig = (): string =>
    JSON.stringify([app.slots(), Object.entries(app.save.thoughts).map(([id, x]) => [id, x.state, x.slot ?? -1]), VOICE_IDS.map((v) => app.save.voices[v]?.level ?? 0)]);

  function internalise(id: string): void {
    const slots = app.slots();
    const taken = new Set(Object.values(app.save.thoughts).filter((x) => x.slot !== undefined).map((x) => x.slot));
    let slot = -1;
    for (let i = 0; i < slots; i++) if (!taken.has(i)) { slot = i; break; }
    if (slot < 0) {
      tkToast({ message: t('cabinet.full'), tone: 'warn' });
      return;
    }
    app.audio.play('paper');
    app.update((d) => {
      const cur = d.thoughts[id];
      d.thoughts[id] = { state: 'internalising', progressMs: cur?.progressMs ?? 0, slot };
    });
  }
  function forget(id: string): void {
    app.audio.play('paper');
    app.update((d) => {
      const cur = d.thoughts[id];
      if (cur) d.thoughts[id] = forgetThought(cur);
    });
  }
  function apply(id: string): void {
    const def = THOUGHTS[id];
    if (!def) return;
    const body = h('div', { class: 'cf-apply' }, h('p', {}, renderRich(def.apply.q)));
    const dlg = tkDialog({
      tone: 'paper',
      eyebrow: t('cabinet.apply'),
      title: richToPlain(def.title),
      body,
      onClose: () => dlg.el.remove(),
    });
    dlg.el.querySelector('.tk-dialog__title')?.replaceChildren(renderRich(def.title));
    def.apply.options.forEach((opt, i) => {
      const b = tkButton({
        label: '',
        variant: 'choice',
        keyHint: String(i + 1),
        onClick: () => {
          if (i === def.apply.answer) {
            app.audio.play('check-pass');
            app.update((d) => {
              const cur = d.thoughts[id];
              if (cur) d.thoughts[id] = { ...cur, state: 'internalised', progressMs: def.minutes * MIN };
            });
            tkToast({ title: t('cabinet.done'), message: def.title, tone: 'success' });
            dlg.close('right');
          } else {
            app.audio.play('deny');
            tkToast({ message: t('cabinet.apply.wrong'), tone: 'info' });
            dlg.close('wrong');
          }
        },
      });
      b.querySelector('.tk-btn__label')?.replaceChildren(renderRich(opt));
      body.appendChild(b);
    });
    dlg.open();
  }

  function paint(): void {
    signature = sig();
    bars.clear();
    const slots = app.slots();
    const th = app.save.thoughts;
    const entries = Object.entries(th) as Array<[string, ThoughtState]>;
    const used = entries.filter(([, x]) => x.slot !== undefined).length;

    /* voices */
    const voicesEl = h('section', { class: 'cf-cab-section', 'aria-labelledby': 'cf-cab-voices' }, h('h2', { class: 'cf-h2', id: 'cf-cab-voices' }, t('cabinet.voices')));
    const grid = h('ul', { class: 'cf-voicegrid' });
    for (const v of VOICE_IDS) {
      const p = app.save.voices[v];
      grid.appendChild(
        h(
          'li',
          { class: 'cf-voicecard' },
          tkVoiceTag({ voice: v, level: p?.level ?? 0, progress: p?.pips ?? 0 }),
          h('p', { class: 'cf-voicecard__role' }, VOICE_ROLES[v]),
        ),
      );
    }
    voicesEl.appendChild(grid);

    /* slots */
    const slotsEl = h(
      'section',
      { class: 'cf-cab-section', 'aria-labelledby': 'cf-cab-slots' },
      h('h2', { class: 'cf-h2', id: 'cf-cab-slots' }, t('cabinet.slots', { used, slots })),
      h('p', { class: 'cf-hint' }, t('cabinet.rule')),
    );
    const slotList = h('ul', { class: 'cf-slots' });
    for (let i = 0; i < MAX_SLOTS; i++) {
      const hit = entries.find(([, x]) => x.slot === i);
      const li = h('li', { class: 'cf-slot' });
      if (i >= slots) {
        li.classList.add('is-locked');
        li.append(tkIcon('lock', { size: 20 }), h('span', {}, t('cabinet.slot.locked', { n: i + 1 })));
      } else if (!hit) {
        li.classList.add('is-empty');
        li.append(h('span', { class: 'cf-slot__n', dir: 'ltr' }, String(i + 1)), h('span', {}, t('cabinet.slotempty')));
      } else {
        const [id, st] = hit;
        const def = THOUGHTS[id];
        const need = (def?.minutes ?? 3) * MIN;
        const cooking = st.state === 'internalising';
        li.classList.add(cooking ? 'is-cooking' : 'is-done');
        const bar = tkProgress({
          label: t('cabinet.progress'),
          value: Math.min(st.progressMs, need),
          max: need,
          tone: cooking ? 'amber' : 'teal',
          compact: true,
          valueText: (v, m) => `${clock(v)} / ${clock(m)}`,
        });
        bars.set(id, { bar, need });
        li.append(
          h('span', { class: 'cf-slot__n', dir: 'ltr' }, String(i + 1)),
          h('div', { class: 'cf-slot__main' },
            h('h3', { class: 'cf-slot__title' }, renderRich(def?.title ?? id)),
            cooking ? bar.el : h('p', { class: 'cf-slot__ok' }, tkIcon('check', { size: 18 }), t('cabinet.internalised')),
          ),
          h('div', { class: 'cf-slot__actions' },
            cooking ? tkButton({ label: t('cabinet.apply'), variant: 'primary', onClick: () => apply(id) }) : null,
            tkButton({ label: t('cabinet.forget'), variant: 'ghost', onClick: () => forget(id) }),
          ),
        );
      }
      slotList.appendChild(li);
    }
    slotsEl.appendChild(slotList);

    /* known thoughts */
    const knownEl = h('section', { class: 'cf-cab-section', 'aria-labelledby': 'cf-cab-known' }, h('h2', { class: 'cf-h2', id: 'cf-cab-known' }, t('cabinet.known')));
    const known = entries.filter(([, x]) => x.state === 'known' || x.state === 'forgotten');
    const freeSlot = used < slots;
    const cards = h('div', { class: 'cf-thoughts' });
    for (const [id, st] of known) {
      const def = THOUGHTS[id];
      if (!def) continue;
      cards.appendChild(
        tkCard({
          kind: 'index',
          eyebrow: st.state === 'forgotten' ? t('cabinet.state.forgotten') : t('cabinet.state.known'),
          title: richToPlain(def.title),
          body: h('span', {}, renderRich(def.body)),
          footer: tkButton({
            label: t('cabinet.internalise'),
            variant: 'secondary',
            disabled: !freeSlot,
            onClick: () => internalise(id),
          }),
        }),
      );
      cards.lastElementChild?.querySelector('.tk-card__title')?.replaceChildren(renderRich(def.title));
    }
    if (!known.length) cards.appendChild(h('p', { class: 'cf-hint' }, t('cabinet.known.empty')));
    knownEl.appendChild(cards);
    if (known.length && !freeSlot) knownEl.appendChild(h('p', { class: 'cf-hint' }, t('cabinet.full')));

    root.replaceChildren(
      h(
        'header',
        { class: 'cf-cabinet__head' },
        h('p', { class: 'cf-hint' }, t('cabinet.intro')),
        h('p', { class: 'cf-cabinet__meta' }, t('cabinet.active'), ' ', ltr(`${used}/${slots}`)),
      ),
      slotsEl,
      knownEl,
      voicesEl,
    );
  }
  paint();

  const unsub = app.store.subscribe(() => {
    if (sig() !== signature) {
      const focused = document.activeElement as HTMLElement | null;
      const wasIn = focused && root.contains(focused);
      paint();
      if (wasIn) root.querySelector<HTMLElement>('.tk-btn')?.focus({ preventScroll: true });
      return;
    }
    for (const [id, { bar, need }] of bars) bar.set(Math.min(app.save.thoughts[id]?.progressMs ?? 0, need));
  });

  return { el: root, destroy: unsub };
}
