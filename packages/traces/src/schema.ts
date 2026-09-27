import { z } from 'zod';

const ms = z.number().nonnegative();

const turnSchema = z.object({
  index: z.number().int().nonnegative(),
  latency: z.object({ voice_to_voice_ms: ms }),
  // Absent on the Connect front door, which does not expose the audio ledger.
  audio: z
    .object({
      planned_ms: ms,
      delivered_ms: ms,
      played_ms: ms,
      flush_latency_ms: ms.optional(),
    })
    .optional(),
  bargein: z.object({ at_ms: ms }).optional(),
  filler: z.object({ played: z.boolean() }).optional(),
  tool: z.object({ name: z.string(), rendering: z.string() }).optional(),
  // Lookups refused because the caller was still reading the code.
  early_tool_calls: z.number().int().positive().optional(),
  assistant: z.object({ final_text: z.string() }),
});

const eventSchema = z
  .object({
    fh: z.object({ id: z.enum(['FH-01', 'FH-03', 'FH-05', 'FH-10']) }),
    at_ms: ms,
    turn: z.number().int().nonnegative().optional(),
    rotation: z.object({ audio_in_ms: ms, audio_forwarded_ms: ms, gap_ms: ms }).optional(),
  })
  .refine((event) => event.fh.id !== 'FH-05' || event.rotation, {
    message: 'FH-05 event requires rotation fields',
    path: ['rotation'],
  });

/** One session's trace: the subset of the trace contract that the acceptance checks read. */
export const traceSchema = z.object({
  session_id: z.string().min(1),
  front_door: z.enum(['softphone', 'connect']),
  started_at: z.iso.datetime(),
  turns: z.array(turnSchema),
  events: z.array(eventSchema),
});

export type Trace = z.infer<typeof traceSchema>;

/** Parses untrusted JSON into a Trace; throws a ZodError naming the offending field. */
export function parseTrace(input: unknown): Trace {
  return traceSchema.parse(input);
}
