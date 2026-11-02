import { cx, h, uiText } from './dom';
import { tkIcon } from './icons';
import { VOICE_ICON, VOICE_MAX_LEVEL, voiceLevelLabel, voiceName, type VoiceId } from './voices';

export interface VoiceTagOptions {
  voice: VoiceId;
  level: number;
  /** Progress pips toward the next level (0..3, 02 section 4.3). Shown as a thin underline. */
  progress?: number;
  /** compact: sigil + pips only (hub strip on phone). Name stays as the accessible label. */
  compact?: boolean;
  /** Hide the level word (e.g. inside a voice bubble header). */
  hideLevelLabel?: boolean;
  /** Renders as a button (tap to expand the voice sheet). */
  onActivate?: () => void;
}

export function tkVoiceTag(o: VoiceTagOptions): HTMLElement {
  const level = Math.max(0, Math.min(VOICE_MAX_LEVEL, Math.round(o.level)));
  const muted = level === 0;
  const name = voiceName(o.voice);
  const levelWord = voiceLevelLabel(level);
  const a11y = `${name}, ${uiText('tk.level')} ${level} ${uiText('tk.of')} ${VOICE_MAX_LEVEL}: ${levelWord}${muted ? `. ${uiText('tk.voice.muted')}` : ''}`;
  const interactive = typeof o.onActivate === 'function';

  const pips = h('span', { class: 'tk-voice__pips', 'aria-hidden': 'true' });
  for (let i = 1; i <= VOICE_MAX_LEVEL; i++) pips.appendChild(h('span', { class: cx('tk-voice__pip', i <= level && 'is-on') }));

  const root = h(
    interactive ? 'button' : 'span',
    {
      class: cx('tk-voice', o.compact && 'tk-voice--compact', muted && 'is-muted'),
      'data-voice': o.voice,
      type: interactive ? 'button' : undefined,
      role: interactive ? undefined : 'img',
      'aria-label': a11y,
      title: o.compact ? `${name}: ${levelWord}` : undefined,
    },
    h('span', { class: 'tk-voice__sigil' }, tkIcon(muted ? 'lock' : VOICE_ICON[o.voice], { size: 18 })),
    o.compact ? null : h('span', { class: 'tk-voice__name', 'aria-hidden': 'true' }, name),
    pips,
    o.compact || o.hideLevelLabel ? null : h('span', { class: 'tk-voice__level', 'aria-hidden': 'true' }, levelWord),
  );
  if (o.progress && level < VOICE_MAX_LEVEL) {
    root.style.setProperty('--tk-voice-progress', String(Math.max(0, Math.min(3, o.progress)) / 3));
    root.classList.add('has-progress');
  }
  if (interactive) root.addEventListener('click', () => o.onActivate?.());
  return root;
}
