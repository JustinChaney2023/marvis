"use client";

import { useSyncExternalStore } from "react";
import Button from "../../ui/Button";

const noopSubscribe = () => () => {};

/**
 * Allow / Cancel, disabled until hydrated: a pre-hydration native form post
 * would get a redirect to the client's (external) callback, which the CSP's
 * form-action 'self' blocks — after hydration the server action's redirect
 * goes through fetch and works.
 */
export default function ConsentButtons({
  onAllow,
  onCancel,
}: {
  onAllow: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div className="mt-5 flex gap-2">
      <form action={onCancel} className="flex-1">
        <Button type="submit" variant="outline" className="w-full" disabled={!hydrated}>
          Cancel
        </Button>
      </form>
      <form action={onAllow} className="flex-1">
        <Button type="submit" className="w-full" disabled={!hydrated}>
          Allow
        </Button>
      </form>
    </div>
  );
}
