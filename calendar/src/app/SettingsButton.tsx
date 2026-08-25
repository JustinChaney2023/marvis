import Link from "next/link";
import { GearIcon } from "./icons";

export default function SettingsButton() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white transition-all hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/60"
    >
      <GearIcon />
    </Link>
  );
}
