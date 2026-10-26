import { z } from 'zod';

export const healthSchema = z.object({
  ok: z.literal(true),
  name: z.literal('megalodon'),
  version: z.string(),
  /** Release tag the server runs from (<data dir>/releases/<tag>); null when it runs from a checkout. */
  release: z.string().nullable(),
  /** Sequence number of the last event in the log; 0 when the log is empty. */
  lastSeq: z.number().int().nonnegative(),
});
export type Health = z.infer<typeof healthSchema>;

/** Error body of every non-2xx JSON response. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
