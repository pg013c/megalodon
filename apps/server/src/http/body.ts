import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '../errors';

/** Parses a JSON body against a contract schema, or fails with 400 INVALID_REQUEST. */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError(400, 'INVALID_REQUEST', 'Body must be JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new AppError(400, 'INVALID_REQUEST', `${where}${issue?.message ?? 'Invalid body'}`);
  }
  return result.data;
}
