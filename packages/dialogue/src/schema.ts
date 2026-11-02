import { z } from 'zod';

const Id = z.string().regex(/^[a-z0-9_]+$/);
export const MAX_TEXT = 140;
export const NAME_BUDGET = 16;
const Text = z.string().min(1);
const Req = z.string().max(120).optional();

export const VOICES = ['logic', 'packet_sense', 'patience', 'suspicion', 'recall', 'command_line'] as const;
export const MOODS = ['neutral', 'worried', 'relieved', 'sly'] as const;
export const VoiceSchema = z.enum(VOICES);
export const MoodSchema = z.enum(MOODS);
export type VoiceId = (typeof VOICES)[number];

const Base = { id: Id, next: Id.optional() };

export const NodeSchema = z.discriminatedUnion('type', [
  z.object({ ...Base, type: z.literal('line'), speaker: Id, text: Text, mood: MoodSchema.optional() }),
  z.object({ ...Base, type: z.literal('narration'), text: Text }),
  z.object({
    ...Base,
    type: z.literal('choice'),
    options: z.array(z.object({ text: Text, next: Id, requires: Req, once: z.boolean().optional() })).min(1).max(5),
  }),
  z.object({
    ...Base,
    type: z.literal('voice'),
    voice: VoiceSchema,
    text: Text,
    minLevel: z.number().int().min(1).max(5),
    mood: MoodSchema.optional(),
  }),
  z.object({
    ...Base,
    type: z.literal('check'),
    voice: VoiceSchema,
    color: z.enum(['white', 'red']),
    target: z.number().int().min(1).max(12),
    evidence: z.array(Id).max(4).default([]),
    onPass: Id,
    onFail: Id,
  }),
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
