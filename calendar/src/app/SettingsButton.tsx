import Link from "next/link";
import { GearIcon } from "./icons";

export default function SettingsButton() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-rule bg-surface text-ink-2 transition-colors hover:bg-rule-soft"
    >
      <GearIcon />
    </Link>
  );
}
