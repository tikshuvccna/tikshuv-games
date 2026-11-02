import { z } from 'zod';

/**
 * Question schemas (01 section 3.4, 03 quiz rules). Strings are i18n keys resolved by the renderer's `t`,
 * except entries marked `literal` (technical tokens: IPs, MACs, commands), which are shown as-is in an LTR island.
 */
const id = z.string().min(1);
const text = z.object({ id, text: z.string().min(1), literal: z.boolean().optional() });

const base = {
  id,
  tier: z.enum(['easy', 'medium', 'hard']).optional(),
  promptKey: z.string().min(1),
  /** Technical token shown in the prompt, e.g. an address or command (rendered LTR). */
  promptToken: z.string().optional(),
  hintKey: z.string().optional(),
  whyKey: z.string().min(1),
  conceptIds: z.array(z.string()).default([]),
};

const uniqueIds = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;

const mcq = z
  .object({
    ...base,
    kind: z.literal('mcq'),
    payload: z.object({ options: z.array(text).min(2), correct: id }),
  })
  .refine((q) => uniqueIds(q.payload.options) && q.payload.options.some((o) => o.id === q.payload.correct), {
    message: 'mcq: option ids must be unique and include the correct id',
  });

const multi = z
  .object({
    ...base,
    kind: z.literal('multi'),
    payload: z.object({ options: z.array(text).min(2), correct: z.array(id).min(1) }),
  })
  .refine(
    (q) =>
      uniqueIds(q.payload.options) &&
      new Set(q.payload.correct).size === q.payload.correct.length &&
      q.payload.correct.every((c) => q.payload.options.some((o) => o.id === c)),
    { message: 'multi: option ids must be unique; correct ids must exist and not repeat' },
  );

const tf = z.object({ ...base, kind: z.literal('tf'), payload: z.object({ correct: z.boolean() }) });

const order = z
  .object({
    ...base,
    kind: z.literal('order'),
    /** `items` is authored in the CORRECT order; the session shuffles the display. */
    payload: z.object({ items: z.array(text).min(2) }),
  })
  .refine((q) => uniqueIds(q.payload.items), { message: 'order: item ids must be unique' });

const match = z
  .object({
    ...base,
    kind: z.literal('match'),
    /** Each pair: left prompt and its right answer. Answer value maps pair id -> chosen right pair id. */
    payload: z.object({
      pairs: z.array(z.object({ id, left: z.string().min(1), right: z.string().min(1), literal: z.boolean().optional() })).min(2),
    }),
  })
  .refine((q) => uniqueIds(q.payload.pairs), { message: 'match: pair ids must be unique' });

const fill = z.object({
  ...base,
  kind: z.literal('fill'),
  payload: z.object({
    /** Accepted answers (technical token: IP, MAC, command). Compared after trim + whitespace collapse. */
    accepted: z.array(z.string().min(1)).min(1),
    caseSensitive: z.boolean().default(false),
    placeholder: z.string().optional(),
  }),
});

/** STUB: terminal-result question. Graded like `fill` (command or result text) until net-sim integration lands. */
const cli = z.object({
  ...base,
  kind: z.literal('cli'),
  payload: z.object({
    accepted: z.array(z.string().min(1)).min(1),
    caseSensitive: z.boolean().default(false),
    /** Scenario id for the future terminal widget; unused by the stub. */
    scenarioId: z.string().optional(),
  }),
});

export const questionSchema = z.discriminatedUnion('kind', [mcq, multi, tf, order, match, fill, cli]);
export const questionsSchema = z.array(questionSchema).superRefine((qs, ctx) => {
  if (!uniqueIds(qs)) ctx.addIssue({ code: 'custom', message: 'question ids must be unique' });
});

export type Question = z.infer<typeof questionSchema>;
export type QuestionKind = Question['kind'];
export type Tier = 'easy' | 'medium' | 'hard';

export function parseQuestions(data: unknown): Question[] {
  return questionsSchema.parse(data);
}

/** Answer value shapes per kind. */
export type AnswerValue = string | string[] | boolean | Record<string, string>;
