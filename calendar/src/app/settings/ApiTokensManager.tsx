"use client";

import { useState } from "react";
import { createApiTokenAction, revokeApiTokenAction } from "../actions";
import Button from "../ui/Button";

export type ApiToken = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
};

const EXPIRY_OPTIONS = [
  { label: "No expiry", days: null },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
] as const;

export default function ApiTokensManager({ tokens }: { tokens: ApiToken[] }) {
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const days = expiryDays ? Number(expiryDays) : null;
      const { rawToken } = await createApiTokenAction(name, days);
      setRevealedToken(rawToken);
      setName("");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {revealedToken && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            Copy this now — you won&apos;t be able to see it again.
          </p>
          <code className="mt-1.5 block overflow-x-auto rounded bg-white px-2 py-1.5 text-xs dark:bg-zinc-900">
            {revealedToken}
          </code>
          <button
            type="button"
            onClick={() => setRevealedToken(null)}
            className="mt-2 text-xs text-amber-700 underline dark:text-amber-400"
          >
            Done, dismiss
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{t.name}</p>
                <p className="text-xs text-zinc-400">
                  Created {t.createdAt.toLocaleDateString()}
                  {t.lastUsedAt ? ` · last used ${t.lastUsedAt.toLocaleDateString()}` : " · never used"}
                  {t.expiresAt ? ` · expires ${t.expiresAt.toLocaleDateString()}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => revokeApiTokenAction(t.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Obsidian - laptop"
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <select
          value={expiryDays}
          onChange={(e) => setExpiryDays(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.label} value={o.days ?? ""}>
              {o.label}
            </option>
          ))}
        </select>
        <Button type="button" pending={isCreating} onClick={handleCreate}>
          Create token
        </Button>
      </div>
    </div>
  );
}
