import Link from "next/link";

export default function SettingsButton() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      className="fixed right-4 top-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm shadow-sm ring-1 ring-black/5 transition-all hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
    >
      ⚙️
    </Link>
  );
}
