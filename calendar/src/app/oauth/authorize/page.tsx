import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { validateAuthorizeParams } from "@/lib/oauth";
import { MarkIcon } from "../../icons";
import Button from "../../ui/Button";
import { respondToAuthorizationAction } from "./actions";

// The consent screen an MCP client (claude.ai, the Claude apps) sends you
// to. Signed-out visitors are bounced through /login by the proxy and
// land back here with the query intact.
export default async function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp ?? {})) {
    if (typeof v === "string") params[k] = v;
  }
  const validated = await validateAuthorizeParams(params);
  if (!validated.ok && !validated.fatal) redirect(validated.redirectTo);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-xl border border-rule bg-surface p-6">
        <MarkIcon className="h-8 w-8" />
        {validated.ok ? (
          <>
            <h1 className="mt-3 font-serif text-2xl text-ink">Connect {validated.clientName}?</h1>
            <p className="mt-2 text-sm text-ink-2">
              <span className="font-medium text-ink">{validated.clientName}</span> wants to use your Season account
              ({user.email}). It will be able to:
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
              <li>see your calendar, tasks, and projects</li>
              <li>add, change, complete, and delete tasks and events</li>
              <li>run the auto-scheduler</li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              You can disconnect it any time in Settings → Claude.
            </p>
            <div className="mt-5 flex gap-2">
              <form action={respondToAuthorizationAction.bind(null, params, false)} className="flex-1">
                <Button type="submit" variant="outline" className="w-full">
                  Cancel
                </Button>
              </form>
              <form action={respondToAuthorizationAction.bind(null, params, true)} className="flex-1">
                <Button type="submit" className="w-full">
                  Allow
                </Button>
              </form>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-3 font-serif text-2xl text-ink">Can&apos;t connect</h1>
            <p className="mt-2 text-sm text-ink-2">{validated.message}</p>
          </>
        )}
      </div>
    </main>
  );
}
