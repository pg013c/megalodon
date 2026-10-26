export type ErrorStatus = 400 | 403 | 404 | 409 | 413 | 500 | 502;

/** An expected failure with a stable code; the HTTP layer turns it into a JSON error. */
export class AppError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
