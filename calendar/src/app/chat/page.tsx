import { requireUser } from "@/lib/auth";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-sm text-ink-2">
        Ask about your own schedule and tasks — &quot;what&apos;s on my plate this
        week?&quot;, &quot;am I free Thursday afternoon?&quot; — or ask it to create,
        reschedule, or delete something. It never changes anything on its
        own: every action shows up as a card you have to confirm first.
      </p>

      <ChatClient />
    </main>
  );
}
