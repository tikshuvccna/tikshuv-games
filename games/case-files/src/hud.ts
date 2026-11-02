/** Top bar: menu button, screen title, brass pocket-watch timer, sound toggle. Plus the menu dialog. */
import { h, tkButton, tkDialog, tkIcon, type IconName } from '@tikshuv/ui';
import type { SessionPreset } from '@tikshuv/core';
import { sessionPreset } from '@tikshuv/core';
import type { App } from './app';
import { t } from './i18n';

export interface Hud {
  el: HTMLElement;
  setTitle(text: string): void;
  setVisible(v: boolean): void;
}

const fmt = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function mountHud(app: App): Hud {
  const title = h('h1', { class: 'cf-hud__title' });
  const time = h('span', { class: 'cf-hud__time', dir: 'ltr' }, '00:00');
  const watch = h(
    'div',
    { class: 'cf-watch', role: 'timer', 'aria-label': t('hud.timer') },
    tkIcon('watch', { size: 20 }),
    time,
  );
  const sound = h('button', { type: 'button', class: 'cf-hud__btn', 'aria-pressed': 'false' });
  const menuBtn = tkButton({ label: t('hud.menu'), icon: 'menu', iconOnly: true, variant: 'ghost', onClick: () => openMenu(app) });
  menuBtn.classList.add('cf-hud__menu');
  const el = h('header', { class: 'cf-hud' }, menuBtn, title, watch, sound);

  const paintSound = () => {
    const muted = app.audio.getSettings().muted.master;
    sound.replaceChildren(
      tkIcon(muted ? 'lock' : 'star', { size: 18 }),
      h('span', { class: 'cf-hud__btn-label' }, muted ? t('sound.off') : t('sound.on')),
    );
    sound.setAttribute('aria-pressed', String(!muted));
    sound.setAttribute('aria-label', muted ? t('sound.turnon') : t('sound.turnoff'));
  };
  sound.addEventListener('click', () => {
    const muted = app.audio.getSettings().muted.master;
    if (muted) void app.audio.enableSound().then(paintSound);
    else {
      app.audio.setMuted(true);
      paintSound();
    }
    paintSound();
  });
  paintSound();
  app.store.subscribe(paintSound);

  const paintTime = () => {
    const cap = app.save.settings.sessionCapMinutes;
    const capped = new URLSearchParams(location.search).has('cap') || cap !== null;
    watch.hidden = !capped;
    const ms = app.timer.elapsed();
    time.textContent = fmt(ms);
    watch.classList.toggle('is-warn', app.timer.phase === 'warned');
  };
  window.setInterval(paintTime, 500);
  paintTime();

  return {
    el,
    setTitle: (text) => {
      title.textContent = text;
      document.title = text ? `${text} - ${t('app.title')}` : t('app.title');
    },
    setVisible: (v) => {
      el.hidden = !v;
    },
  };
}

function openMenu(app: App): void {
  app.timer.pause('menu');
  const nav = (label: string, route: string, icon: IconName): HTMLElement =>
    tkButton({
      label,
      icon,
      variant: 'secondary',
      block: true,
      onClick: () => {
        dlg.close('nav');
        app.router.go(route);
      },
    });

  const calm = h('input', { type: 'checkbox', id: 'cf-calm' });
  calm.checked = document.documentElement.hasAttribute('data-calm');
  calm.addEventListener('change', () => {
    document.documentElement.toggleAttribute('data-calm', calm.checked);
  });

  const cap = h('select', { id: 'cf-cap', class: 'cf-select' });
  const opts: Array<[string, SessionPreset]> = [
    ['10', 10],
    ['12', 12],
    ['15', 15],
    ['off', 'off'],
  ];
  const current = app.save.settings.sessionCapMinutes ?? 'off';
  for (const [value, preset] of opts) {
    const o = h('option', { value }, preset === 'off' ? t('menu.cap.off') : t('menu.cap.min', { n: preset }));
    if (preset === current) o.selected = true;
    cap.appendChild(o);
  }
  cap.addEventListener('change', () => {
    const v = cap.value;
    const preset: SessionPreset = v === 'off' ? 'off' : (Number(v) as 10 | 12 | 15);
    app.update((d) => {
      d.settings.sessionCapMinutes = preset === 'off' ? null : preset;
    });
    app.timer.setConfig(sessionPreset(preset));
  });

  const dlg = tkDialog({
    title: t('menu.title'),
    body: [
      h(
        'div',
        { class: 'cf-menu' },
        nav(t('nav.hub'), 'hub', 'stamp'),
        nav(t('nav.board'), 'board', 'evidence'),
        nav(t('nav.cabinet'), 'cabinet', 'cabinet'),
        nav(t('nav.codex'), 'codex', 'recall'),
        h('label', { class: 'cf-field', for: 'cf-cap' }, h('span', {}, t('menu.cap')), cap),
        h('label', { class: 'cf-field cf-field--check', for: 'cf-calm' }, calm, h('span', {}, t('menu.calm'))),
      ),
    ],
    onClose: () => {
      app.timer.resume('menu');
      dlg.el.remove();
    },
  });
  dlg.open();
}
