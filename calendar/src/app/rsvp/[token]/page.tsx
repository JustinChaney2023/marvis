import { notFound } from "next/navigation";
import { getInviteAction } from "../../actions";
import RsvpClient from "./RsvpClient";

// Public — no login required. The token in the URL is the guest's only
// credential (#34), same "the link itself is the auth" model the public
// booking page already uses.
export default async function RsvpPage(props: PageProps<"/rsvp/[token]">) {
  const { token } = await props.params;
  const invite = await getInviteAction(token);
  if (!invite) notFound();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-12">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-2xl font-bold tracking-tight">{invite.eventTitle}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {invite.eventStart.toLocaleString()} – {invite.eventEnd.toLocaleTimeString()}
        </p>
        {invite.meetingUrl && /^https?:\/\//i.test(invite.meetingUrl) && (
          <a
            href={invite.meetingUrl}
            className="mt-1 inline-block text-sm text-indigo-600 dark:text-indigo-400"
          >
            {invite.meetingUrl}
          </a>
        )}
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Invited: <span className="font-medium">{invite.email}</span>
        </p>
        <RsvpClient token={token} initialStatus={invite.status} />
      </div>
    </main>
  );
}
