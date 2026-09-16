import type { z } from 'zod';

/** `code` is a stable identifier the page and widget translate; never change one in place. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new ApiError(404, `${what}_not_found`);

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      400,
      'invalid_request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
