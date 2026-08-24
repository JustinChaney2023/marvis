import Link from "next/link";
import { loginAction } from "../authActions";
import Button from "../ui/Button";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const rawNext = sp?.next;
  const next = (Array.isArray(rawNext) ? rawNext[0] : rawNext) || "/";
  const rawError = sp?.error;
  const errorParam = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorMessage =
    errorParam === "1"
      ? "Incorrect email or password."
      : errorParam
        ? errorParam
        : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="text-xl font-bold tracking-tight">Marvis Calendar</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to continue.
        </p>
        <form action={loginAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
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
            placeholder="Password"
            required
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800"
          />
          {errorMessage && (
            <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          )}
          <Button type="submit">Sign in</Button>
        </form>
        <p className="mt-3 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/forgot-password" className="font-medium text-indigo-600 dark:text-indigo-400">
            Forgot password?
          </Link>
        </p>
        <p className="mt-1 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No account?{" "}
          <Link href="/signup" className="font-medium text-indigo-600 dark:text-indigo-400">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
