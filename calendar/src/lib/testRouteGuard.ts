/**
 * Second, independent gate for the /api/test/* helper routes, on top of
 * each route's own NODE_ENV check. A single `NODE_ENV !== "production"`
 * check is one misconfigured deploy away from shipping zero-auth
 * data-mutation endpoints (arbitrary event creation, delete-by-title-
 * prefix) to a real, public instance — some hosts don't set NODE_ENV at
 * all unless you run their specific build command. Requiring an explicit
 * opt-in env var means these routes are off by default even in a
 * misconfigured "not production" environment; a Playwright run must set
 * E2E_TEST_ROUTES=1 (e.g. `E2E_TEST_ROUTES=1 npm run dev`) to use them.
 */
export function testRoutesAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.E2E_TEST_ROUTES === "1";
}
