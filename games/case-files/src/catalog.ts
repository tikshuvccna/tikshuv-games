/** Typed access to the content JSON (cases, units, places, evidence, thoughts, codex) and the scene registry. */
import { DialogueSceneSchema, type DialogueScene } from '@tikshuv/dialogue';
import type { IconName, VoiceId } from '@tikshuv/ui';
import catalogJson from '../content/he/catalog.json';
import worldJson from '../content/he/world.json';
import p00 from '../content/he/p00_demo.json';

export interface CaseDef {
  id: string;
  num: number;
  title: string;
  hook: string;
  place: string;
  units: string[];
  scene?: string;
  playable?: boolean;
  finale?: boolean;
}
export interface Hotspot {
  id: string;
  x: number;
  y: number;
  label: string;
  icon: IconName;
  evidenceId?: string;
  note?: string;
}
export interface PlaceDef {
  title: string;
  mood: string;
  hotspots: Hotspot[];
}
export interface EvidenceDef {
  title: string;
  body: string;
}
export interface DeductionDef {
  title: string;
  text: string;
  requires: string[];
}
export interface ThoughtDef {
  title: string;
  kind: 'concept' | 'misconception';
  minutes: 3 | 6;
  tags: string[];
  body: string;
  apply: { q: string; options: string[]; answer: number };
}
export interface CodexDef {
  id: string;
  term: string;
  en: string;
  unit: string;
  unlock: string;
  def: string;
}

export const CASES = catalogJson.cases as CaseDef[];
export const UNITS = catalogJson.units as Record<string, { title: string }>;
export const VOICE_ROLES = catalogJson.voices as Record<VoiceId, string>;
export const PLACES = worldJson.places as unknown as Record<string, PlaceDef>;
export const EVIDENCE = worldJson.evidence as Record<string, EvidenceDef>;
export const DEDUCTIONS = worldJson.deductions as Record<string, DeductionDef>;
export const THOUGHTS = worldJson.thoughts as unknown as Record<string, ThoughtDef>;
export const CODEX = worldJson.codex as CodexDef[];

/** Case id to its unit ids, in play order, as `isCaseUnlocked` expects. The finale needs every unit. */
export const CASE_UNITS: Record<string, readonly string[]> = Object.fromEntries(
  CASES.filter((c) => c.id !== 'prologue').map((c) => [c.id, c.units]),
);

const SCENES: Record<string, unknown> = { p00_demo: p00 };

export function loadScene(id: string): DialogueScene | null {
  const raw = SCENES[id];
  if (!raw) return null;
  const parsed = DialogueSceneSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export const SCENE_SOURCES = SCENES;

export function caseById(id: string): CaseDef | undefined {
  return CASES.find((c) => c.id === id);
}

/** Thought tags for the runner's check bonus. */
export function thoughtTags(): Record<string, readonly string[]> {
  return Object.fromEntries(Object.entries(THOUGHTS).map(([id, d]) => [id, d.tags]));
}

/** Scene mood id (VOICE_BIBLE) to the colour-grade mood on the page (style bible section 4). */
export function gradeFor(mood: string | null | undefined): string {
  switch (mood) {
    case 'mood_terminal':
      return 'terminal';
    case 'mood_check_white':
    case 'mood_cabinet':
    case 'mood_quiz':
      return 'deduction';
    case 'mood_check_red':
    case 'mood_fail_forward':
    case 'mood_finale_dark':
      return 'suspicion';
    case 'mood_solved':
    case 'mood_finale_roof':
    case 'mood_finale_restore':
      return 'solved';
    case 'mood_blackout':
      return 'blackout';
    case 'mood_c1_post':
    case 'mood_c2_harbour':
    case 'mood_c3_newsroom':
    case 'mood_c4_basement':
    case 'mood_c5_lighthouse':
    case 'mood_interview':
      return 'investigate';
    default:
      return 'bureau';
  }
}
