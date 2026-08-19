import Link from "next/link";
import { signupAction } from "../authActions";
import Button from "../ui/Button";

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const rawError = sp?.error;
  const error = Array.isArray(rawError) ? rawError[0] : rawError;
  const inviteRequired = Boolean(process.env.SIGNUP_INVITE_CODE);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-xl font-bold tracking-tight">Create an account</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your own calendar, tasks, and Google connection.
        </p>
        <form action={signupAction} className="mt-4 flex flex-col gap-3">
          {inviteRequired && (
            <input
              name="inviteCode"
              placeholder="Invite code"
              required
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
            />
          )}
          <input
            name="name"
            placeholder="Name (optional)"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <input
            type="email"
            name="email"
            placeholder="Email"
            autoFocus
            required
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          <input
            type="password"
            name="password"
            placeholder="Password (min. 8 characters)"
            required
            minLength={8}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <Button type="submit">Sign up</Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-indigo-600 dark:text-indigo-400">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
