import { h, tkButton, tkDialog, tkIcon } from '@tikshuv/ui';
import type { App } from '../app';
import { harbourSkyline } from '../art';
import { t } from '../i18n';
import type { Screen } from '../router';

export function titleScreen(app: App): Screen {
  app.setMood('mood_title');
  document.title = t('app.title');
  const returning = app.save.lastPlayedAt !== null;

  /* ---- sound prompt (audio is muted on first run) ---- */
  const soundBox = h('section', { class: 'cf-sound', 'aria-labelledby': 'cf-sound-h' });
  const paintSound = (): void => {
    soundBox.replaceChildren();
    const muted = app.audio.getSettings().muted.master;
    if (app.audio.needsSoundPrompt) {
      soundBox.classList.add('is-ask');
      soundBox.append(
        h('span', { class: 'cf-sound__icon' }, tkIcon('star', { size: 28 })),
        h(
          'div',
          { class: 'cf-sound__text' },
          h('h2', { class: 'cf-sound__title', id: 'cf-sound-h' }, t('sound.prompt.title')),
          h('p', {}, t('sound.prompt.body')),
        ),
        h(
          'div',
          { class: 'cf-sound__actions' },
          tkButton({
            label: t('sound.prompt.yes'),
            variant: 'primary',
            size: 'lg',
            onClick: () => {
              void app.audio.enableSound().then(() => {
                app.audio.play('confirm');
                app.setMood('mood_title');
                paintSound();
              });
            },
          }),
          tkButton({
            label: t('sound.prompt.no'),
            variant: 'ghost',
            onClick: () => {
              app.audio.declineSound();
              paintSound();
            },
          }),
        ),
      );
    } else {
      soundBox.classList.remove('is-ask');
      soundBox.append(
        h('span', { class: 'cf-sound__icon' }, tkIcon(muted ? 'lock' : 'star', { size: 22 })),
        h('p', { class: 'cf-sound__state', id: 'cf-sound-h' }, muted ? t('sound.state.off') : t('sound.state.on')),
        tkButton({
          label: muted ? t('sound.turnon') : t('sound.turnoff'),
          variant: 'ghost',
          onClick: () => {
            if (muted) void app.audio.enableSound().then(paintSound);
            else {
              app.audio.setMuted(true);
              paintSound();
            }
          },
        }),
      );
    }
  };
  paintSound();

  /* ---- name + start ---- */
  const nameInput = h('input', {
    id: 'cf-name',
    class: 'cf-input',
    type: 'text',
    maxlength: 16,
    autocomplete: 'off',
    placeholder: t('title.name.placeholder'),
    value: app.save.profile.displayName,
  });
  const nameField = h('div', { class: 'cf-field cf-field--stack' }, h('label', { for: 'cf-name' }, t('title.name')), nameInput);

  const begin = (route: string): void => {
    const name = nameInput.value.trim().slice(0, 16);
    app.update((d) => {
      d.profile.displayName = name;
      d.lastPlayedAt = new Date().toISOString();
    });
    app.audio.play('confirm');
    app.startSession();
    app.router.go(route);
  };

  const resumeScene = app.save.dialogue?.sceneId;
  const actions = h('div', { class: 'cf-title__actions' });
  if (returning) {
    actions.append(
      tkButton({
        label: resumeScene ? t('title.resume') : t('title.continue'),
        variant: 'primary',
        size: 'lg',
        icon: 'chevron',
        iconEnd: true,
        onClick: () => begin(resumeScene ? `scene/${resumeScene}` : 'hub'),
      }),
      tkButton({
        label: t('title.new'),
        variant: 'ghost',
        onClick: () => confirmReset(app, () => begin('scene/p00_demo')),
      }),
    );
  } else {
    actions.append(
      tkButton({
        label: t('title.start'),
        variant: 'primary',
        size: 'lg',
        icon: 'chevron',
        iconEnd: true,
        onClick: () => begin('scene/p00_demo'),
      }),
    );
  }

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (actions.querySelector('.tk-btn--primary') as HTMLElement | null)?.click();
  });

  const el = h(
    'div',
    { class: 'cf-title' },
    h('div', { class: 'cf-title__art' }, harbourSkyline()),
    h(
      'div',
      { class: 'cf-title__card' },
      h('p', { class: 'cf-eyebrow' }, t('title.eyebrow')),
      h('h1', { class: 'cf-title__h1' }, t('app.title')),
      h('p', { class: 'cf-title__sub' }, returning ? t('title.welcome.back', { name: app.name }) : t('title.tagline')),
      soundBox,
      nameField,
      actions,
      h('p', { class: 'cf-title__note' }, t('title.note')),
    ),
  );
  return { el };
}

function confirmReset(app: App, then: () => void): void {
  const dlg = tkDialog({
    title: t('title.reset.title'),
    body: h('p', {}, t('title.reset.body')),
    actions: [
      tkButton({
        label: t('title.reset.yes'),
        variant: 'danger',
        onClick: () => {
          dlg.close('yes');
          app.resetProgress();
          then();
        },
      }),
      tkButton({ label: t('ui.notnow'), variant: 'ghost', onClick: () => dlg.close('no') }),
    ],
    onClose: () => dlg.el.remove(),
  });
  dlg.open();
}
