import { loginAction } from "../actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const rawNext = sp?.next;
  const next = (Array.isArray(rawNext) ? rawNext[0] : rawNext) || "/";
  const hasError = sp?.error === "1";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold tracking-tight">Marvis Calendar</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter the password to continue.
        </p>
        <form action={loginAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="password"
            autoFocus
            required
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
          />
          {hasError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Incorrect password.
            </p>
          )}
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
