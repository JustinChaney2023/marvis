"use client";

import { useEffect, useRef, useState } from "react";
import { askScheduleChatAction } from "../actions";
import Button from "../ui/Button";

type Message = { role: "user" | "assistant"; content: string };

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
      const result = await askScheduleChatAction(next);
      if (result.ok) {
        setMessages([...next, { role: "assistant", content: result.reply }]);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mt-6 flex flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-200 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
            Ask a question to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              className={
                m.role === "user"
                  ? "max-w-[80%] whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white"
                  : "max-w-[80%] whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              }
            >
              {m.content}
            </p>
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
