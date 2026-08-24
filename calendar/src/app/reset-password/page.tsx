import Link from "next/link";
import { resetPasswordAction } from "../authActions";
import Button from "../ui/Button";

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const sp = await props.searchParams;
  const rawToken = sp?.token;
  const token = (Array.isArray(rawToken) ? rawToken[0] : rawToken) ?? "";
  const rawError = sp?.error;
  const errorMessage = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-xl font-bold tracking-tight">Set a new password</h1>

        {!token ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">
            Missing reset token. Use the link from the email, or{" "}
            <Link href="/forgot-password" className="font-medium text-indigo-600 dark:text-indigo-400">
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
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
            {errorMessage && (
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            )}
            <Button type="submit">Set password</Button>
          </form>
        )}
      </div>
    </main>
  );
}
