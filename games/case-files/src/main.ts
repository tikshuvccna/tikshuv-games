/** Case Files shell: save, audio, session timer, HUD, hash router with fade transitions. */
import '@tikshuv/ui';
import { createSaveStore, type LifecycleTarget } from '@tikshuv/save';
import { h, tkToast } from '@tikshuv/ui';
import { App } from './app';
import { mountHud } from './hud';
import { t } from './i18n';
import { Router } from './router';
import { blackoutScreen } from './screens/blackout';
import { boardScreen } from './screens/board';
import { cabinetScreen } from './screens/cabinet';
import { codexScreen } from './screens/codex';
import { hubScreen } from './screens/hub';
import { inspectScreen } from './screens/inspect';
import { sceneScreen } from './screens/scene';
import { titleScreen } from './screens/title';
import { seedDemo } from './seed';
import './styles/cf-base.css';
import './styles/screens.css';

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const store = createSaveStore({ onError: (m, e) => console.warn('save:', m, e) });
  const loaded = await store.load();
  store.bindLifecycle(window as unknown as LifecycleTarget);

  const app = new App(store);
  const params = new URLSearchParams(location.search);
  if (params.get('seed') === 'demo') seedDemo(app);
  if (params.has('calm')) document.documentElement.setAttribute('data-calm', '');

  const hud = mountHud(app);
  const stage = h('main', { class: 'cf-stage', id: 'cf-main' });
  const skip = h('a', { class: 'cf-skip', href: '#cf-main' }, t('a11y.skip'));
  root.append(skip, hud.el, stage);

  const router = new Router<App>(app, stage);
  app.router = router;
  router
    .add('title', titleScreen, { chrome: false })
    .add('hub', hubScreen, { title: 'nav.hub' })
    .add('scene', sceneScreen, { title: 'nav.scene' })
    .add('inspect', inspectScreen, { title: 'nav.inspect' })
    .add('cabinet', cabinetScreen, { title: 'nav.cabinet' })
    .add('board', boardScreen, { title: 'nav.board' })
    .add('codex', codexScreen, { title: 'nav.codex' })
    .add('blackout', blackoutScreen, { chrome: false })
    .add('dev', async (a) => (await import('./screens/lab')).labScreen(a), { title: 'nav.dev' })
    .setFallback('title');

  router.onChange((c) => {
    const chrome = c.meta.chrome !== false;
    hud.setVisible(chrome);
    document.body.dataset['screen'] = c.name;
    if (chrome) {
      hud.setTitle(c.title ?? (c.meta.title ? t(c.meta.title) : ''));
      // deep links (#/hub, #/dev) start the session clock too
      if (app.timer.phase === 'idle') app.startSession();
    }
  });

  if (loaded.readOnly) tkToast({ message: t('save.readonly'), tone: 'warn', timeout: 0 });
  else if (loaded.warnings.length) console.info('save warnings', loaded.warnings);
  router.start();
  (window as unknown as { __cf?: App }).__cf = app;
}

void boot();
