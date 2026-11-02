import type { NodeOf } from './schema.js';

export const EVIDENCE_CAP = 3;
export const THOUGHT_CAP = 2;
export const APPLY_BONUS = 2;
export const OVERREACH_PENALTY = 1;

export interface CheckInput {
  voiceLevel: number;
  /** temporary voice modifiers (counted with the voice term) */
  modifiers: number;
  /** relevant evidence items held / examined (capped at +3) */
  evidenceHeld: number;
  /** internalised thoughts whose tags match the check (capped at +2) */
  thoughtMatches?: number;
  /** the show-your-reasoning micro-question was answered correctly (+2) */
  applied?: boolean;
  /** a mandatory inspect node was skipped (-1) */
  overreach?: boolean;
}

/** Every term is shown to the player: "Logic 3 + Evidence 2 + Reasoning 2 = 7, needed 6". */
export interface CheckTerms {
  voice: number;
  evidence: number;
  thought: number;
  apply: number;
  overreach: number;
}

export interface CheckResult {
  terms: CheckTerms;
  score: number;
  target: number;
  passed: boolean;
  /** how many more points a retry needs (0 when passed) */
  missing: number;
}

/** Spec 02 section 4.2. Deterministic, no dice. */
export function resolveCheck(node: Pick<NodeOf<'check'>, 'target'>, input: CheckInput): CheckResult {
  const terms: CheckTerms = {
    voice: input.voiceLevel + input.modifiers,
    evidence: Math.min(EVIDENCE_CAP, Math.max(0, input.evidenceHeld)),
    thought: Math.min(THOUGHT_CAP, Math.max(0, input.thoughtMatches ?? 0)),
    apply: input.applied ? APPLY_BONUS : 0,
    overreach: input.overreach ? -OVERREACH_PENALTY : 0,
  };
  const score = terms.voice + terms.evidence + terms.thought + terms.apply + terms.overreach;
  const passed = score >= node.target;
  return { terms, score, target: node.target, passed, missing: passed ? 0 : node.target - score };
}
