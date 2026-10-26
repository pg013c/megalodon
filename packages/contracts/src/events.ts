import { z } from 'zod';

/** Who caused an event or made a decision (CONCEPTS.md §7). */
export const actorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('operator') }),
  z.object({ kind: z.literal('system') }),
  z.object({ kind: z.literal('policy'), policy: z.string() }),
  z.object({ kind: z.literal('agent'), agentId: z.string(), version: z.string() }),
]);
export type Actor = z.infer<typeof actorSchema>;

/** An event as a command proposes it, before the store assigns identity and order. */
export const newEventSchema = z.object({
  type: z.string().min(1),
  /** The aggregate the event belongs to, e.g. `project:<id>` or `task:<id>`. */
  stream: z.string().min(1),
  data: z.unknown(),
  actor: actorSchema,
});
export type NewEvent = z.infer<typeof newEventSchema>;

/** An event as stored in the log. `seq` is the global, gap-free order of the log. */
export const storedEventSchema = newEventSchema.extend({
  seq: z.number().int().positive(),
  id: z.string(),
  at: z.string(),
});
export type StoredEvent = z.infer<typeof storedEventSchema>;
