/** Inspect: a placeholder scene with hotspot objects that give evidence. Used as a route and inside scenes. */
import { h, renderRich, tkButton, tkDialog, tkIcon, tkToast } from '@tikshuv/ui';
import type { App } from '../app';
import { placeScene } from '../art';
import { EVIDENCE, PLACES } from '../catalog';
import { t } from '../i18n';
import type { Screen } from '../router';

export interface InspectOptions {
  placeId: string;
  /** Embedded in a dialogue scene: this evidence must be found before "done" appears. */
  required?: string;
  onDone?: () => void;
  /** Called for every newly found evidence (the scene forwards it to the runner, which saves it). */
  onEvidence?: (id: string) => void;
}

export function mountInspect(app: App, o: InspectOptions): Screen {
  const place = PLACES[o.placeId] ?? PLACES['bureau']!;
  const found = new Set<string>(app.save.evidence);
  const total = place.hotspots.filter((x) => x.evidenceId).length;

  const counter = h('p', { class: 'cf-inspect__count', 'aria-live': 'polite' });
  const done = h('div', { class: 'cf-inspect__done' });
  const stage = h('div', { class: 'cf-place' }, placeScene(o.placeId));

  const refresh = (): void => {
    const n = place.hotspots.filter((x) => x.evidenceId && found.has(x.evidenceId)).length;
    counter.textContent = t('inspect.count', { n, total });
    done.replaceChildren();
    const ready = o.required ? found.has(o.required) : true;
    if (o.onDone && ready) {
      done.append(tkButton({ label: t('inspect.done'), variant: 'primary', size: 'lg', icon: 'check', onClick: () => o.onDone?.() }));
    } else if (o.onDone) done.append(h('p', { class: 'cf-hint' }, t('inspect.need')));
  };

  for (const hs of place.hotspots) {
    const evId = hs.evidenceId;
    const isFound = (): boolean => (evId ? found.has(evId) : false);
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'cf-hotspot',
        style: `left:${hs.x}%;top:${hs.y}%`,
        'aria-label': hs.label,
      },
      h('span', { class: 'cf-hotspot__ring' }, tkIcon(hs.icon, { size: 22 })),
      h('span', { class: 'cf-hotspot__label', 'aria-hidden': 'true' }, hs.label),
    );
    if (isFound()) btn.classList.add('is-found');
    btn.addEventListener('click', () => {
      app.audio.play('paper');
      const ev = evId ? EVIDENCE[evId] : undefined;
      const fresh = !!evId && !found.has(evId);
      if (evId && fresh) {
        found.add(evId);
        if (o.onEvidence) o.onEvidence(evId);
        else app.update((d) => void (d.evidence.includes(evId) || d.evidence.push(evId)));
        btn.classList.add('is-found');
        app.audio.play('sparkle');
        tkToast({ title: t('inspect.new'), message: ev?.title ?? evId, tone: 'reward', icon: 'evidence' });
        refresh();
      }
      const dlg = tkDialog({
        tone: 'paper',
        eyebrow: ev ? t('inspect.eyebrow') : t('inspect.note'),
        title: ev?.title ?? hs.label,
        body: h('p', {}, renderRich(ev?.body ?? hs.note ?? '')),
        actions: [tkButton({ label: t('tk.close'), variant: 'secondary', onClick: () => dlg.close('ok') })],
        onClose: () => {
          dlg.el.remove();
          btn.focus();
        },
      });
      dlg.open();
    });
    stage.appendChild(btn);
  }
  refresh();

  const el = h(
    'div',
    { class: 'cf-inspect' },
    h(
      'header',
      { class: 'cf-inspect__head' },
      h('h2', { class: 'cf-h2' }, place.title),
      counter,
    ),
    h('p', { class: 'cf-inspect__help' }, t('inspect.help')),
    stage,
    done,
  );
  return { el };
}

export function inspectScreen(app: App, args: string[]): Screen {
  const placeId = args[0] ?? 'bureau';
  const place = PLACES[placeId] ?? PLACES['bureau']!;
  app.setMood(place.mood === 'investigate' ? 'mood_c1_post' : 'mood_hub');
  const inner = mountInspect(app, { placeId });
  inner.el.append(tkButton({ label: t('nav.hub'), variant: 'secondary', onClick: () => app.router.go('hub') }));
  return inner;
}
