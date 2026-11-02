import { demoAccountEmail, getCurrentUser, hasOwnerSession } from "@/lib/auth";
import { enterDemoAction, leaveDemoAction } from "./demoSwitchActions";

// Bottom-left quick switch between the owner and the demo account.
// Renders nothing unless DEMO_ACCOUNT_EMAIL is set, and then only for an
// admin (to enter) or for the demo account when it was entered via the
// switch (to leave) — never for anyone else.
export default async function DemoSwitch() {
  const demoEmail = demoAccountEmail();
  const user = demoEmail ? await getCurrentUser() : null;
  if (!demoEmail || !user) return null;

  const inDemo = user.email.toLowerCase() === demoEmail;
  if (inDemo ? !(await hasOwnerSession()) : !user.isAdmin) return null;

  // Above the phone tab bar; beside the side rail on desktop.
  return (
    <form
      action={inDemo ? leaveDemoAction : enterDemoAction}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 z-30 md:bottom-3 md:left-[12rem] print:hidden"
    >
      <button
        type="submit"
        className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
          inDemo
            ? "border-accent bg-accent text-paper"
            : "border-rule bg-surface text-ink-2 hover:bg-rule-soft"
        }`}
      >
        {inDemo ? "Demo · back to my account" : "Switch to demo"}
      </button>
    </form>
  );
}
