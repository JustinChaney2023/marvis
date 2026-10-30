"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { approveAuthorization, denialRedirect, validateAuthorizeParams } from "@/lib/oauth";

// Re-validates everything from the raw params rather than trusting what
// the consent form echoed back — the form is just a confirmation click.
export async function respondToAuthorizationAction(params: Record<string, string>, approved: boolean) {
  const user = await requireUser();
  const validated = await validateAuthorizeParams(params);
  if (!validated.ok) {
    if (validated.fatal) throw new Error(validated.message);
    redirect(validated.redirectTo);
  }
  redirect(approved ? await approveAuthorization(user.id, validated.request) : denialRedirect(validated.request));
}
