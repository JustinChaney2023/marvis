"use client";

import { useEffect, useRef, useState } from "react";
import { askScheduleChatAction, executeChatActionAction } from "../actions";
import { describeChatAction, type ChatAction } from "@/lib/chatActions";
import Button from "../ui/Button";

type PendingAction = { action: ChatAction; status: "pending" | "confirmed" | "cancelled" | "error"; error?: string };
type Message = { role: "user" | "assistant"; content: string; actions?: PendingAction[] };

export default function ChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const next = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(next);
    setInput("");
    setError(null);
    setIsSending(true);
    try {
      const result = await askScheduleChatAction(next.map((m) => ({ role: m.role, content: m.content })));
      if (result.ok) {
        setMessages([
          ...next,
          {
            role: "assistant",
            content: result.reply,
            actions: result.actions.map((action) => ({ action, status: "pending" as const })),
          },
        ]);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  };

  // Confirming/cancelling one card only ever touches that one card's
  // status — a sibling proposed action in the same reply stays
  // independently confirmable, since the user might want 2 of 3.
  const updateActionStatus = (messageIndex: number, actionIndex: number, patch: Partial<PendingAction>) => {
    setMessages((prev) =>
      prev.map((m, mi) =>
        mi !== messageIndex || !m.actions
          ? m
          : { ...m, actions: m.actions.map((a, ai) => (ai === actionIndex ? { ...a, ...patch } : a)) },
      ),
    );
  };

  const handleConfirm = async (messageIndex: number, actionIndex: number, action: ChatAction) => {
    const result = await executeChatActionAction(action);
    updateActionStatus(
      messageIndex,
      actionIndex,
      result.ok ? { status: "confirmed" } : { status: "error", error: result.error },
    );
  };

  const handleCancel = (messageIndex: number, actionIndex: number) => {
    updateActionStatus(messageIndex, actionIndex, { status: "cancelled" });
  };

  return (
    <div className="mt-6 flex flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
            Ask a question, or ask it to create/reschedule/delete something.
          </p>
        )}
        {messages.map((m, mi) => (
          <div key={mi} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
            <p
              className={
                m.role === "user"
                  ? "max-w-[80%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-zinc-900"
                  : "max-w-[80%] whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              }
            >
              {m.content}
            </p>
            {m.actions?.map((pending, ai) => (
              <div
                key={ai}
                className="w-full max-w-[80%] rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/40"
              >
                <p className="text-zinc-800 dark:text-zinc-200">{describeChatAction(pending.action)}</p>
                {pending.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      onClick={() => handleConfirm(mi, ai, pending.action)}
                    >
                      Confirm
                    </Button>
                    <Button type="button" variant="outline" onClick={() => handleCancel(mi, ai)}>
                      Cancel
                    </Button>
                  </div>
                )}
                {pending.status === "confirmed" && (
                  <p className="mt-1 text-xs font-medium text-green-700 dark:text-green-400">Done.</p>
                )}
                {pending.status === "cancelled" && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Cancelled.</p>
                )}
                {pending.status === "error" && (
                  <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                    {pending.error ?? "Something went wrong."}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
              Thinking…
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What's on my plate this week?"
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
        />
        <Button type="submit" pending={isSending} disabled={!input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
