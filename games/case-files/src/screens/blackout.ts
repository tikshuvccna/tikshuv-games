/** 12:00 blackout: the lights go out, a short note, then a teleport back to the hub (spec 02 8.2). */
import { h, prefersReducedMotion, tkButton, tkIcon } from '@tikshuv/ui';
import type { App } from '../app';
import { t } from '../i18n';
import type { Screen } from '../router';

const AUTO_MS = 7000;

export function blackoutScreen(app: App): Screen {
  app.setMood('mood_blackout');
  document.title = t('blackout.title');
  let timer = 0;
  let gone = false;
  const leave = (): void => {
    if (gone) return;
    gone = true;
    window.clearTimeout(timer);
    app.beginNewSession();
    app.router.go('hub');
  };

  const el = h(
    'div',
    { class: 'cf-blackout' + (prefersReducedMotion() ? '' : ' is-flicker') },
    h(
      'div',
      { class: 'cf-blackout__card', role: 'alert' },
      h('span', { class: 'cf-blackout__icon' }, tkIcon('watch', { size: 56 })),
      h('h1', { class: 'cf-blackout__title' }, t('blackout.title')),
      h('p', { class: 'cf-blackout__text' }, t('blackout.text')),
      h('p', { class: 'cf-blackout__next' }, t('blackout.next')),
      tkButton({ label: t('blackout.back'), variant: 'primary', size: 'lg', onClick: leave }),
    ),
  );
  timer = window.setTimeout(leave, AUTO_MS);
  window.setTimeout(() => el.querySelector<HTMLElement>('.tk-btn')?.focus(), 50);
  return {
    el,
    destroy: () => {
      window.clearTimeout(timer);
      // leaving by any other route still starts a fresh session
      if (!gone) {
        gone = true;
        app.beginNewSession();
      }
    },
  };
}
