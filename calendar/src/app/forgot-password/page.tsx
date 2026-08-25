import Link from "next/link";
import { forgotPasswordAction } from "../authActions";
import Button from "../ui/Button";

export default async function ForgotPasswordPage(props: PageProps<"/forgot-password">) {
  const sp = await props.searchParams;
  const rawError = sp?.error;
  const errorMessage = Array.isArray(rawError) ? rawError[0] : rawError;
  const sent = Boolean(sp?.sent);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-xl font-bold tracking-tight">Reset password</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter your account email and we&apos;ll send a reset link.
        </p>

        {sent ? (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
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
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
            {errorMessage && (
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            )}
            <Button type="submit">Send reset link</Button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-indigo-600 dark:text-indigo-400">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
