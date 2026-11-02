/**
 * @tikshuv/ui - Case Files design system (task O1). Source-only workspace package.
 * Importing it registers the tokens and the tk-* component styles.
 * Visual rules: docs/style_bible.md. Live reference: games/case-files/design-system.html.
 */
import './tokens.css';
import './components.css';
import palette from './palette.json';

export { palette };
export { h, append, cx, ltr, parseRich, renderRich, richToPlain, setUiStrings, uiText, prefersReducedMotion } from './dom';
export type { Child, RichSegment } from './dom';
export { tkIcon, ICON_NAMES } from './icons';
export type { IconName, IconOptions } from './icons';
export { VOICE_IDS, VOICE_ICON, VOICE_MAX_LEVEL, voiceName, voiceLevelLabel } from './voices';
export type { VoiceId } from './voices';
export { tkButton } from './button';
export type { ButtonOptions, ButtonVariant } from './button';
export { tkCard } from './card';
export type { CardOptions, CardKind } from './card';
export { tkDialog } from './dialog';
export type { DialogOptions, DialogHandle } from './dialog';
export { tkToast, tkToastEl } from './toast';
export type { ToastOptions, ToastTone } from './toast';
export { tkTabs } from './tabs';
export type { TabsOptions, TabDef } from './tabs';
export { tkProgress } from './progress';
export type { ProgressOptions, ProgressHandle, ProgressTone } from './progress';
export { tkBubble } from './bubble';
export type { BubbleOptions, BubbleHandle, BubbleKind } from './bubble';
export { tkVoiceTag } from './voice-tag';
export type { VoiceTagOptions } from './voice-tag';
export { tkStamp, stampThunk } from './stamp';
export type { StampOptions, StampTone } from './stamp';

/** Scene moods (04 addendum). Set on a scene root as data-mood. */
export const MOODS = ['bureau', 'investigate', 'terminal', 'deduction', 'suspicion', 'solved', 'blackout'] as const;
export type Mood = (typeof MOODS)[number];
