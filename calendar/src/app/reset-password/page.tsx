import Link from "next/link";
import { resetPasswordAction } from "../authActions";
import Button from "../ui/Button";
import Card from "../ui/Card";

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const sp = await props.searchParams;
  const rawToken = sp?.token;
  const token = (Array.isArray(rawToken) ? rawToken[0] : rawToken) ?? "";
  const rawError = sp?.error;
  const errorMessage = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <Card padding="lg" className="w-full">
        <h1 className="font-serif text-2xl text-ink">Set a new password</h1>

        {!token ? (
          <p className="mt-4 text-sm text-accent">
            Missing reset token. Use the link from the email, or{" "}
            <Link href="/forgot-password" className="font-medium text-accent hover:text-ink">
              request a new one
            </Link>
            .
          </p>
        ) : (
          <form action={resetPasswordAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <input
              type="password"
              name="newPassword"
              placeholder="New password"
              autoFocus
              required
              minLength={8}
              className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
            />
            {errorMessage && <p className="text-sm text-accent">{errorMessage}</p>}
            <Button type="submit">Set password</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
