"use client";

import { useRouter } from "next/navigation";
import { FullscreenTimer, useAnchoredCountdown } from "../ui/FullscreenTimer";

export default function TimerClient({
  title,
  totalSeconds,
  initialSecondsLeft,
}: {
  title: string;
  totalSeconds: number;
  initialSecondsLeft: number;
}) {
  const { secondsLeft, running, toggleRun, reset } = useAnchoredCountdown(totalSeconds, initialSecondsLeft, true);
  const router = useRouter();

  return (
    <FullscreenTimer
      title={title}
      totalSeconds={totalSeconds}
      secondsLeft={secondsLeft}
      running={running}
      onToggleRun={toggleRun}
      onReset={reset}
      onExit={() => router.push("/")}
    />
  );
}
