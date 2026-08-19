import { requireUser } from "@/lib/auth";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Chat</h1>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Ask about your own schedule and tasks — "what's on my plate this
        week?", "am I free Thursday afternoon?". Read-only: it can answer
        questions but can't create, edit, or delete anything.
      </p>

      <ChatClient />
    </main>
  );
}
