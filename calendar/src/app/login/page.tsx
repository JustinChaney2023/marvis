import Link from "next/link";
import { loginAction } from "../authActions";
import Button from "../ui/Button";
import Card from "../ui/Card";

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
      <Card padding="lg" className="w-full">
        <h1 className="font-serif text-2xl text-ink">Marvis Calendar</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to continue.</p>
        <form action={loginAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
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
            placeholder="Password"
            required
            className="rounded-lg border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none"
          />
          {errorMessage && <p className="text-sm text-accent">{errorMessage}</p>}
          <Button type="submit">Sign in</Button>
        </form>
        <p className="mt-3 text-center text-sm text-ink-2">
          <Link href="/forgot-password" className="font-medium text-accent hover:text-ink">
            Forgot password?
          </Link>
        </p>
        <p className="mt-1 text-center text-sm text-ink-2">
          No account?{" "}
          <Link href="/signup" className="font-medium text-accent hover:text-ink">
            Sign up
          </Link>
        </p>
      </Card>
    </main>
  );
}
