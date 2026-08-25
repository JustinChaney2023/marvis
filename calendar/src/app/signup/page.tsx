import Link from "next/link";
import { signupAction } from "../authActions";
import Button from "../ui/Button";
import Card from "../ui/Card";

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const rawError = sp?.error;
  const error = Array.isArray(rawError) ? rawError[0] : rawError;
  const inviteRequired = Boolean(process.env.SIGNUP_INVITE_CODE);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <Card padding="lg" className="w-full">
        <h1 className="font-serif text-2xl text-ink">Create an account</h1>
        <p className="mt-1 text-sm text-ink-2">
          Your own calendar, tasks, and Google connection.
        </p>
        <form action={signupAction} className="mt-4 flex flex-col gap-3">
          {inviteRequired && (
            <input
              name="inviteCode"
              placeholder="Invite code"
              required
              className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
            />
          )}
          <input
            name="name"
            placeholder="Name (optional)"
            className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            autoFocus
            required
            className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            name="password"
            placeholder="Password (min. 8 characters)"
            required
            minLength={8}
            className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
          {error && <p className="text-sm text-accent">{error}</p>}
          <Button type="submit">Sign up</Button>
        </form>
        <p className="mt-4 text-center text-sm text-ink-2">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:text-ink">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
