// Runs once per server start, before the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { applyOwnerTimezone } = await import("@/lib/serverTimezone");
    await applyOwnerTimezone();
    const { startPushLoop } = await import("@/lib/push");
    startPushLoop();
  }
}
