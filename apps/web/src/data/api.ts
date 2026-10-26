import { apiErrorSchema } from '@megalodon/contracts';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the server and validates the answer against its contract. */
export async function api<S extends z.ZodType>(path: string, schema: S, init?: { method?: string; body?: unknown }): Promise<z.infer<S>> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
    throw parsed.success
      ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(res.status, 'HTTP_ERROR', `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(await res.json());
}
