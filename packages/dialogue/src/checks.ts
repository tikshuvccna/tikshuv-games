import type { NodeOf } from './schema.js';

export interface CheckInput {
  voiceLevel: number;
  modifiers: number;
  evidenceHeld: number;
}
export interface CheckResult {
  score: number;
  target: number;
  passed: boolean;
  /** how many more points a retry needs (0 when passed) */
  missing: number;
}

/** Deterministic: voice level + modifiers + 1 per linked evidence held, vs target. No dice. */
export function resolveCheck(node: Pick<NodeOf<'check'>, 'target'>, input: CheckInput): CheckResult {
  const score = input.voiceLevel + input.modifiers + input.evidenceHeld;
  const passed = score >= node.target;
  return { score, target: node.target, passed, missing: passed ? 0 : node.target - score };
}
