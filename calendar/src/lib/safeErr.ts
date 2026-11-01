/**
 * A log-safe one-liner for an error. A googleapis GaxiosError carries the
 * whole request (Authorization header, refresh-token body), and logging the
 * object prints all of it — so log this instead of the error itself.
 */
export function safeErr(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  return code ? `${err.message} (${String(code)})` : err.message;
}
