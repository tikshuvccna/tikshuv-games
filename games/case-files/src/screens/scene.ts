/** Scene view: plays a DialogueScene with the DialogueRunner (bubbles, choices, checks, inspect, end card). */
import { DialogueRunner, type DialogueEvent, type View } from '@tikshuv/dialogue';
import type { SceneMoodId } from '@tikshuv/core';
import { addVoicePips } from '@tikshuv/save';
import {
  VOICE_ICON,
  VOICE_IDS,
  h,
  ltr,
  renderRich,
  tkBubble,
  tkButton,
  tkCard,
  tkDialog,
  tkStamp,
  tkToast,
  voiceName,
  type BubbleHandle,
  type VoiceId,
} from '@tikshuv/ui';
import type { App } from '../app';
import { placeScene, portraitEl, voiceSigilEl } from '../art';
import { CASES, EVIDENCE, PLACES, THOUGHTS, loadScene, thoughtTags } from '../catalog';
import { t } from '../i18n';
import type { Screen } from '../router';
import { mountInspect } from './inspect';

type BubbleMood = 'neutral' | 'worried' | 'relieved' | 'sly';

export function sceneScreen(app: App, args: string[]): Screen {
  const sceneId = args[0] ?? 'p00_demo';
  const scene = loadScene(sceneId);
  if (!scene) {
    const el = h(
      'div',
      { class: 'cf-scene-missing' },
      h('p', {}, t('scene.missing')),
      tkButton({ label: t('nav.hub'), variant: 'primary', onClick: () => app.router.go('hub') }),
    );
    return { el };
  }
  const sceneDef = scene;
  const caseDef = CASES.find((c) => c.scene === sceneId);
  const sceneMood = (sceneDef.mood ?? 'mood_hub') as SceneMoodId;
  app.setMood(sceneMood);
  const releases: Array<() => void> = [];

  /* ---------------------------------------------------------------- runner */
  const s = app.save;
  const voices: Partial<Record<VoiceId, number>> = {};
  for (const v of VOICE_IDS) voices[v] = s.voices[v]?.level ?? 0;
  // The prologue wakes Logic so the first check is winnable; the save keeps the real level afterwards.
  if (caseDef?.num === 0 && (voices.logic ?? 0) < 1) voices.logic = 1;
  const known = Object.entries(s.thoughts).filter(([, x]) => x.state !== 'locked').map(([id]) => id);
  const internalised = Object.entries(s.thoughts).filter(([, x]) => x.state === 'internalised').map(([id]) => id);
  const runner = new DialogueRunner({
    name: app.name,
    voices,
    flags: { ...s.flags },
    evidence: [...s.evidence],
    thoughts: known,
    internalised,
    thoughtTags: thoughtTags(),
    redResults: { ...(s.dialogue?.sceneId === sceneDef.id ? s.dialogue.redResults : {}) },
    t: (k) => t(k),
  });

  runner.on((e: DialogueEvent) => {
    switch (e.type) {
      case 'evidence':
        app.update((d) => void (d.evidence.includes(e.id) || d.evidence.push(e.id)));
        break;
      case 'thought':
        app.update((d) => {
          if (!d.thoughts[e.id]) d.thoughts[e.id] = { state: 'known', progressMs: 0 };
        });
        app.audio.play('notification');
        tkToast({ title: t('thought.new'), message: THOUGHTS[e.id]?.title ?? e.id, tone: 'reward', icon: 'cabinet' });
        break;
      case 'flag':
        app.update((d) => void (d.flags[e.flag] = e.value));
        break;
      case 'end':
        break;
      default:
        break;
    }
  });

  /* ---------------------------------------------------------------- DOM skeleton */
  const art = h('div', { class: 'cf-scene__art' }, placeScene(sceneDef.location ?? 'bureau'));
  const who = h('div', { class: 'cf-scene__who' });
  const stage = h('div', { class: 'cf-scene__stage' }, art, who);
  const textArea = h('div', { class: 'cf-scene__text', 'aria-live': 'polite' });
  const choices = h('div', { class: 'cf-scene__choices', role: 'group', 'aria-label': t('scene.choices') });
  const controls = h('div', { class: 'cf-scene__controls' });
  const box = h('div', { class: 'cf-scene__box' }, textArea, choices, controls);
  const evidenceBtn = tkButton({ label: '', icon: 'evidence', onClick: () => showEvidence() });
  const bar = h(
    'div',
    { class: 'cf-scene__bar' },
    evidenceBtn,
    tkButton({ label: t('nav.cabinet'), icon: 'cabinet', onClick: () => app.router.go('cabinet') }),
    tkButton({ label: t('ui.hint'), icon: 'hint', disabled: true }),
  );
  const root = h('div', { class: 'cf-scene' }, stage, box, bar);
  const paintEvidence = (): void => {
    const lbl = evidenceBtn.querySelector('.tk-btn__label');
    if (lbl) lbl.textContent = t('scene.evidence', { n: app.save.evidence.length });
  };
  paintEvidence();
  const unsub = app.store.subscribe(paintEvidence);

  let bubble: BubbleHandle | null = null;
  let current: View | null = null;
  let inspecting: Screen | null = null;

  const setWho = (kind: 'none' | 'speaker' | 'voice', id?: string, name?: string, voice?: VoiceId): void => {
    who.replaceChildren();
    who.dataset['kind'] = kind;
    if (kind === 'speaker' && id) who.appendChild(portraitEl(id, name ?? id));
    if (kind === 'voice' && voice) who.appendChild(voiceSigilEl(voice, VOICE_ICON[voice]));
  };

  const focusPrimary = (): void => {
    const target = controls.querySelector<HTMLElement>('.tk-btn--primary') ?? choices.querySelector<HTMLElement>('.tk-btn:not([disabled])');
    target?.focus({ preventScroll: true });
  };

  function saveResume(): void {
    app.update((d) => {
      d.dialogue = runner.snapshot();
      if (caseDef) d.cases[caseDef.id] = { ...(d.cases[caseDef.id] ?? { solved: false }), currentScene: sceneDef.id };
    });
  }

  /* ---------------------------------------------------------------- render a view */
  function render(view: View): void {
    current = view;
    inspecting?.destroy?.();
    inspecting = null;
    root.classList.remove('is-inspecting');
    choices.replaceChildren();
    controls.replaceChildren();

    switch (view.type) {
      case 'line':
      case 'narration':
      case 'voice': {
        const kind = view.type;
        const voice = view.voice;
        const lvl = voice ? (app.save.voices[voice]?.level ?? voices[voice] ?? 0) : 0;
        if (kind === 'line') {
          const sp = sceneDef.speakers[(view.node as { speaker: string }).speaker];
          setWho('speaker', sp?.portrait ?? 'p_npc', view.speaker);
        } else if (kind === 'voice' && voice) setWho('voice', undefined, undefined, voice);
        else setWho('none');
        textArea.replaceChildren();
        const cont = tkButton({
          label: t('tk.continue'),
          variant: 'primary',
          size: 'lg',
          icon: 'chevron',
          iconEnd: true,
          onClick: () => advance(),
        });
        cont.classList.add('is-wait');
        bubble = tkBubble({
          kind,
          text: view.text ?? '',
          ...(kind === 'line' && view.speaker ? { speaker: view.speaker } : {}),
          ...(view.mood ? { mood: view.mood as BubbleMood } : {}),
          ...(kind === 'voice' && voice ? { voice, voiceLevel: view.locked ? 0 : Math.max(1, lvl) } : {}),
          continueHint: false,
          onDone: () => cont.classList.remove('is-wait'),
        });
        textArea.appendChild(bubble.el);
        if (bubble.finished) cont.classList.remove('is-wait');
        controls.appendChild(cont);
        saveResume();
        break;
      }
      case 'choice': {
        // the last line stays above the options (spec 02 7.2)
        (view.options ?? []).forEach((o) => {
          const b = tkButton({
            label: '',
            variant: 'choice',
            keyHint: String(o.index + 1),
            disabled: !o.available,
            onClick: () => pick(o.index),
          });
          const lbl = b.querySelector('.tk-btn__label');
          lbl?.replaceChildren(renderRich(o.text));
          choices.appendChild(b);
        });
        saveResume();
        break;
      }
      case 'check':
        openCheck(view);
        saveResume();
        break;
      case 'external':
        renderExternal(view);
        saveResume();
        break;
      case 'end':
        renderEnd(view);
        break;
    }
    window.setTimeout(focusPrimary, 0);
  }

  function advance(): void {
    if (!current) return;
    if (bubble && !bubble.finished) {
      bubble.skip();
      return;
    }
    app.audio.play('click');
    try {
      render(runner.advance());
    } catch (e) {
      console.error(e);
    }
  }

  function pick(i: number): void {
    app.audio.play('click');
    render(runner.choose(i));
  }

  /* ---------------------------------------------------------------- check overlay */
  function openCheck(view: View): void {
    const chk = view.check;
    if (!chk) return;
    const node = view.node as { voice: VoiceId };
    const isRed = chk.color === 'red';
    const release = isRed ? app.hold() : () => {};
    releases.push(release);
    app.setMood(isRed ? 'mood_check_red' : 'mood_check_white');
    app.audio.play('paper');

    const checkResult = chk.result;
    const terms = checkResult.terms;
    const chips: HTMLElement[] = [];
    const chip = (label: string, n: number, sign = false): HTMLElement =>
      h(
        'span',
        { class: 'cf-term' },
        h('span', { class: 'cf-term__label' }, label),
        h('span', { class: 'cf-term__n' }, ltr(sign && n > 0 ? `+${n}` : String(n))),
      );
    chips.push(chip(voiceName(node.voice), terms.voice));
    chips.push(chip(t('check.term.evidence'), terms.evidence, true));
    if (terms.thought) chips.push(chip(t('check.term.thought'), terms.thought, true));
    if (terms.apply) chips.push(chip(t('check.term.apply'), terms.apply, true));
    if (terms.overreach) chips.push(chip(t('check.term.overreach'), terms.overreach, true));

    const body = h('div', { class: 'cf-check' });
    const stampKind = tkStamp({
      text: isRed ? t('check.red') : t('check.white'),
      tone: isRed ? 'rust' : 'teal',
      icon: isRed ? 'stamp' : 'check',
      size: 'sm',
      angle: -4,
    });
    const paintPreview = (): void => {
      body.replaceChildren(
        h('div', { class: 'cf-check__row' }, stampKind, h('p', { class: 'cf-check__kind' }, isRed ? t('check.red.note') : t('check.white.note'))),
        h('div', { class: 'cf-check__sum', role: 'group', 'aria-label': t('check.sum') }, ...chips),
        h(
          'p',
          { class: 'cf-check__need' },
          t('check.score'),
          ' ',
          ltr(`${chk.result.score}`),
          ' / ',
          t('check.target'),
          ' ',
          ltr(`${chk.result.target}`),
        ),
        h('p', { class: 'cf-check__warn' }, isRed ? t('check.red.warn') : ''),
        h(
          'div',
          { class: 'cf-check__actions' },
          tkButton({ label: t('check.go'), variant: isRed ? 'danger' : 'primary', icon: 'check', onClick: () => resolve() }),
          chk.canBail ? tkButton({ label: t('ui.notnow'), variant: 'secondary', onClick: () => bail() }) : null,
        ),
      );
    };

    const dlg = tkDialog({
      tone: 'paper',
      eyebrow: t('check.eyebrow'),
      title: t('check.title', { voice: voiceName(node.voice) }),
      body,
      modalLocked: isRed,
      closable: false,
      onClose: () => {
        dlg.el.remove();
        release();
        app.setMood(sceneMood);
        if (current === view && dlg.el.returnValue === '') {
          // dismissed with Esc on a white check: treat as "not now" when possible
          if (chk.canBail) render(runner.bail());
          else openCheck(view);
        }
      },
    });
    const finish = (rv: string): void => dlg.close(rv);

    function resolve(): void {
      const passed = checkResult.passed;
      const result = checkResult;
      const next = runner.confirm();
      app.audio.play(passed ? 'check-pass' : 'check-fail');
      if (passed) {
        app.update((d) => {
          d.voices[node.voice] = addVoicePips(d.voices[node.voice], 1);
        });
      }
      body.replaceChildren(
        h(
          'div',
          { class: 'cf-check__row' },
          tkStamp({
            text: passed ? t('check.pass') : t('check.fail'),
            tone: passed ? 'teal' : 'rust',
            icon: passed ? 'check' : 'warning',
            size: 'md',
            animate: true,
          }),
        ),
        h(
          'p',
          { class: 'cf-check__need' },
          t('check.score'),
          ' ',
          ltr(`${result.score}`),
          ' / ',
          t('check.target'),
          ' ',
          ltr(`${result.target}`),
        ),
        h('p', {}, passed ? t('check.pass.note', { voice: voiceName(node.voice) }) : t('check.fail.note', { n: result.missing })),
        h(
          'div',
          { class: 'cf-check__actions' },
          tkButton({
            label: t('tk.continue'),
            variant: 'primary',
            onClick: () => {
              finish('done');
              render(next);
            },
          }),
        ),
      );
      body.querySelector<HTMLElement>('.tk-btn')?.focus();
    }
    function bail(): void {
      finish('bail');
      render(runner.bail());
    }

    paintPreview();
    dlg.open();
    body.querySelector<HTMLElement>('.tk-btn')?.focus();
    // the dialog returnValue stays '' only when it is dismissed without one of our actions
    dlg.el.returnValue = '';
  }

  /* ---------------------------------------------------------------- external hand-offs */
  function renderExternal(view: View): void {
    const ext = view.external;
    if (!ext) return;
    setWho('none');
    textArea.replaceChildren();
    if (ext.kind === 'inspect') {
      const place = PLACES[sceneDef.location ?? 'bureau'] ? (sceneDef.location ?? 'bureau') : 'bureau';
      const evidenceId = ext.payload['evidenceId'];
      root.classList.add('is-inspecting');
      inspecting = mountInspect(app, {
        placeId: place,
        ...(evidenceId ? { required: evidenceId } : {}),
        onEvidence: (id) => runner.grantEvidence(id),
        onDone: () => render(runner.resolveExternal('done')),
      });
      textArea.appendChild(inspecting.el);
      return;
    }
    const isTerminal = ext.kind === 'terminal';
    textArea.appendChild(
      tkCard({ kind: 'memo', eyebrow: t(isTerminal ? 'external.terminal' : 'external.quiz'), title: t('external.todo.title'), body: h('p', {}, t('external.todo')) }),
    );
    controls.append(
      tkButton({
        label: t(isTerminal ? 'external.done' : 'external.right'),
        variant: 'primary',
        onClick: () => render(runner.resolveExternal(isTerminal ? 'done' : 'right')),
      }),
      tkButton({
        label: t(isTerminal ? 'external.giveup' : 'external.wrong'),
        variant: 'secondary',
        onClick: () => render(runner.resolveExternal(isTerminal ? 'giveUp' : 'wrong')),
      }),
    );
  }

  /* ---------------------------------------------------------------- end */
  function renderEnd(view: View): void {
    const node = view.node as { result?: string };
    const solved = node.result === 'solved' || node.result === undefined;
    setWho('none');
    app.setMood(solved ? 'mood_solved' : 'mood_fail_forward');
    app.audio.play('stamp');
    app.update((d) => {
      delete d.dialogue;
      if (caseDef) d.cases[caseDef.id] = { solved: solved || d.cases[caseDef.id]?.solved === true };
      d.xp += solved ? 10 : 3;
    });
    textArea.replaceChildren(
      h(
        'div',
        { class: 'cf-end' },
        tkStamp({ text: solved ? t('result.closed') : t('result.later'), tone: solved ? 'teal' : 'brass', icon: solved ? 'check' : 'watch', size: 'lg', animate: true }),
        h('p', { class: 'cf-end__text' }, caseDef ? t('end.note', { title: caseDef.title }) : t('end.note.generic')),
      ),
    );
    controls.append(tkButton({ label: t('end.back'), variant: 'primary', size: 'lg', onClick: () => app.router.go('hub') }));
    window.setTimeout(focusPrimary, 0);
  }

  /* ---------------------------------------------------------------- evidence list */
  function showEvidence(): void {
    const list = h('div', { class: 'cf-evlist' });
    for (const id of app.save.evidence) {
      const ev = EVIDENCE[id];
      if (ev) list.appendChild(tkCard({ kind: 'index', title: ev.title, level: 3, body: h('span', {}, renderRich(ev.body)) }));
    }
    if (!list.childElementCount) list.appendChild(h('p', {}, t('board.evidence.empty')));
    const dlg = tkDialog({
      title: t('nav.board'),
      body: list,
      actions: [
        tkButton({ label: t('nav.board'), variant: 'primary', onClick: () => (dlg.close('board'), app.router.go('board')) }),
        tkButton({ label: t('tk.close'), variant: 'secondary', onClick: () => dlg.close('ok') }),
      ],
      onClose: () => dlg.el.remove(),
    });
    dlg.open();
  }

  /* ---------------------------------------------------------------- keyboard: Enter/Space continue, 1-5 choose */
  const onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('dialog[open]')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (current && (current.type === 'line' || current.type === 'narration' || current.type === 'voice') && (e.key === 'Enter' || e.key === ' ')) {
      if (tag === 'BUTTON') return; // the focused button handles its own activation
      e.preventDefault();
      advance();
      return;
    }
    if (current?.type === 'choice' && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (current.options?.[i]?.available) pick(i);
    }
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    // tapping the bubble itself fast-forwards the typewriter
    if (bubble && !bubble.finished && (e.target as HTMLElement).closest('.tk-bubble')) bubble.skip();
  });

  /* ---------------------------------------------------------------- start or resume */
  const resume = app.save.dialogue?.sceneId === sceneDef.id ? app.save.dialogue : undefined;
  let first: View;
  try {
    first = resume ? runner.restore(sceneDef, resume) : runner.start(sceneDef);
  } catch (e) {
    console.error('resume failed, restarting scene', e);
    first = runner.start(sceneDef);
  }
  render(first);

  return {
    el: root,
    title: caseDef ? caseDef.title : sceneDef.id,
    destroy: () => {
      document.removeEventListener('keydown', onKey);
      unsub();
      inspecting?.destroy?.();
      releases.forEach((r) => r());
      document.querySelectorAll('dialog').forEach((d) => d.remove());
    },
  };
}
