import { z } from 'zod';
import { VOICE_IDS, type VoiceId as CoreVoiceId } from '@tikshuv/core';

const Id = z.string().regex(/^[a-z0-9_]+$/);
export const MAX_TEXT = 140;
export const NAME_BUDGET = 16;
const Text = z.string().min(1);
const Req = z.string().max(120).optional();

export const VOICES = VOICE_IDS;
export const MOODS = ['neutral', 'worried', 'relieved', 'sly'] as const;
export const VoiceSchema = z.enum(VOICES);
export const MoodSchema = z.enum(MOODS);
export type VoiceId = CoreVoiceId;

const Base = { id: Id, next: Id.optional() };

export const NodeSchema = z.discriminatedUnion('type', [
  z.object({ ...Base, type: z.literal('line'), speaker: Id, text: Text, mood: MoodSchema.optional() }),
  z.object({ ...Base, type: z.literal('narration'), text: Text }),
  z.object({
    ...Base,
    type: z.literal('choice'),
    options: z.array(z.object({ text: Text, next: Id, requires: Req, once: z.boolean().optional() })).min(2).max(5),
  }),
  z.object({
    ...Base,
    type: z.literal('voice'),
    voice: VoiceSchema,
    text: Text,
    minLevel: z.number().int().min(1).max(5),
    hintCost: z.number().int().min(0).max(1).optional(),
    mood: MoodSchema.optional(),
  }),
  z.object({
    ...Base,
    type: z.literal('check'),
    voice: VoiceSchema,
    color: z.enum(['white', 'red']),
    target: z.number().int().min(2).max(9),
    evidence: z.array(Id).max(4).default([]),
    /** thought tags: each internalised thought carrying one adds +1 (max +2) */
    tags: z.array(Id).max(6).default([]),
    /** quiz-bank question id for the show-your-reasoning micro-question (+2 when answered right) */
    reasoning: Id.optional(),
    /** evidence that must be inspected first; skipping any costs -1 (overreach) */
    mustInspect: z.array(Id).max(4).default([]),
    /** where the player goes when choosing not-now before confirming */
    onBail: Id.optional(),
    onPass: Id,
    onFail: Id,
  }),
  z.object({ ...Base, type: z.literal('inspect'), evidenceId: Id }),
  z.object({ ...Base, type: z.literal('terminal'), deviceId: Id, goal: Id, onDone: Id, onGiveUp: Id }),
  z.object({ ...Base, type: z.literal('quiz'), questionId: Id, onRight: Id, onWrong: Id }),
  z.object({ ...Base, type: z.literal('evidence'), evidenceId: Id }),
  z.object({ ...Base, type: z.literal('thought'), thoughtId: Id }),
  z.object({ ...Base, type: z.literal('set'), flag: Id, value: z.union([z.boolean(), z.number()]) }),
  z.object({
    ...Base,
    type: z.literal('branch'),
    cases: z.array(z.object({ if: z.string(), next: Id })).min(1),
    else: Id,
  }),
  z.object({ ...Base, type: z.literal('goto'), target: Id }),
  z.object({
    ...Base,
    type: z.literal('end'),
    result: z.enum(['solved', 'partial', 'continue']).optional(),
    unlock: Id.optional(),
  }),
]);

export const DialogueSceneSchema = z.object({
  schema: z.literal(1),
  id: Id,
  location: Id.optional(),
  mood: Id.optional(),
  music: Id.optional(),
  speakers: z.record(z.string(), z.object({ nameKey: z.string(), portrait: Id.optional() })),
  start: Id,
  nodes: z.array(NodeSchema).min(1),
});

export type DialogueNode = z.infer<typeof NodeSchema>;
export type DialogueScene = z.infer<typeof DialogueSceneSchema>;
export type NodeOf<T extends DialogueNode['type']> = Extract<DialogueNode, { type: T }>;
