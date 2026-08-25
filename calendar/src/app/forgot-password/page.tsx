import Link from "next/link";
import { forgotPasswordAction } from "../authActions";
import Button from "../ui/Button";
import Card from "../ui/Card";

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const sp = await props.searchParams;
  const rawError = sp?.error;
  const errorMessage = Array.isArray(rawError) ? rawError[0] : rawError;
  const sent = Boolean(sp?.sent);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <Card padding="lg" className="w-full">
        <h1 className="font-serif text-2xl text-ink">Reset password</h1>
        <p className="mt-1 text-sm text-ink-2">
          Enter your account email and we&apos;ll send a reset link.
        </p>

        {sent ? (
          <p className="mt-4 rounded-lg border border-rule-soft bg-rule-soft px-3 py-2 text-sm text-ink-2">
            If that email has an account, a reset link is on its way. It expires in 1 hour.
          </p>
        ) : (
          <form action={forgotPasswordAction} className="mt-4 flex flex-col gap-3">
            <input
              type="email"
              name="email"
              placeholder="Email"
              autoFocus
              required
              className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
            />
            {errorMessage && <p className="text-sm text-accent">{errorMessage}</p>}
            <Button type="submit">Send reset link</Button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-ink-2">
          <Link href="/login" className="font-medium text-accent hover:text-ink">
            Back to sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
