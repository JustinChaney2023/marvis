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
        <div className="rounded-lg border border-accent bg-accent-wash p-3 text-sm">
          <p className="font-medium text-accent">
            Copy this now — you won&apos;t be able to see it again.
          </p>
          <code className="mt-1.5 block overflow-x-auto rounded bg-surface px-2 py-1.5 text-xs text-ink">
            {revealedToken}
          </code>
          <ConnectClaude token={revealedToken} />
          <button
            type="button"
            onClick={() => setRevealedToken(null)}
            className="mt-2 text-xs text-accent underline"
          >
            Done, dismiss
          </button>
        </div>
      )}
      {!revealedToken && (
        <p className="text-xs text-muted">
          <span className="font-medium text-ink-2">Connect Claude:</span> create a token
          (e.g. &ldquo;Claude&rdquo;) and Season will show the exact setup for Claude Code,
          Claude Desktop, and claude.ai — Claude can then see your agenda, add and
          complete tasks, and run the auto-scheduler.
        </p>
      )}

      {tokens.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-rule px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{t.name}</p>
                <p className="text-xs text-muted font-mono">
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

      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Claude, or Obsidian - laptop"
          className="min-w-[12rem] flex-1 rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink"
        />
        <select
          value={expiryDays}
          onChange={(e) => setExpiryDays(e.target.value)}
          className="rounded-lg border border-rule bg-surface px-2 py-2 text-sm text-ink"
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

// Setup snippets for Season's MCP server (src/lib/mcp.ts), filled in with
// the just-created token since that's the only moment it's visible.
function ConnectClaude({ token }: { token: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/api/mcp`;
  const snippets = [
    {
      label: "Claude Code",
      value: `claude mcp add --transport http season ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
      label: "claude.ai / Claude app (Settings → Connectors → Add custom connector)",
      value: `${url}/${token}`,
    },
    {
      label: "Claude Desktop (claude_desktop_config.json → mcpServers)",
      value: JSON.stringify(
        { season: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${token}`] } },
        null,
        2,
      ),
    },
  ];
  return (
    <details className="mt-3 text-xs text-ink-2">
      <summary className="cursor-pointer font-medium text-accent">Use this token to connect Claude</summary>
      <div className="mt-2 flex flex-col gap-2">
        {snippets.map((s) => (
          <div key={s.label}>
            <p className="mb-1 text-muted">{s.label}</p>
            <CopyBlock value={s.value} />
          </div>
        ))}
        <p className="text-muted">
          The connector URL contains the token itself, so keep it private. claude.ai has to be
          able to reach this server over the internet — a localhost URL only works with
          Claude Code and Claude Desktop on this machine.
        </p>
      </div>
    </details>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1.5 font-mono text-[11px] text-ink">
        {value}
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex-shrink-0 rounded border border-rule px-2 py-1 text-[11px] text-ink-2 hover:bg-rule-soft"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
