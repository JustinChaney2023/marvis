import { notFound } from "next/navigation";
import { getInviteAction } from "../../actions";
import RsvpClient from "./RsvpClient";
import Card from "../../ui/Card";

// Public — no login required. The token in the URL is the guest's only
// credential (#34), same "the link itself is the auth" model the public
// booking page already uses.
export default async function RsvpPage(props: PageProps<"/rsvp/[token]">) {
  const { token } = await props.params;
  const invite = await getInviteAction(token);
  if (!invite) notFound();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 bg-paper px-6 py-12">
      <Card padding="lg">
        <h1 className="font-serif text-3xl text-ink">{invite.eventTitle}</h1>
        <p className="mt-1 font-mono text-[12px] text-ink-2">
          {invite.eventStart.toLocaleString()} – {invite.eventEnd.toLocaleTimeString()}
        </p>
        {invite.meetingUrl && /^https?:\/\//i.test(invite.meetingUrl) && (
          <a
            href={invite.meetingUrl}
            className="mt-1 inline-block text-[13px] text-accent hover:underline"
          >
            {invite.meetingUrl}
          </a>
        )}
        <p className="mt-4 text-[13px] text-ink-2">
          Invited: <span className="font-medium text-ink">{invite.email}</span>
        </p>
        <RsvpClient token={token} initialStatus={invite.status} />
      </Card>
    </main>
  );
}
