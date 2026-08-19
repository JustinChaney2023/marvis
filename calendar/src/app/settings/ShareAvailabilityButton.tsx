"use client";

import { useState } from "react";
import { getShareAvailabilityTextAction } from "../actions";
import Button from "../ui/Button";

export default function ShareAvailabilityButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const handleClick = async () => {
    try {
      const text = await getShareAvailabilityTextAction();
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch (err) {
      console.error(err);
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  return (
    <Button type="button" variant="secondary" onClick={handleClick}>
      {status === "copied" ? "Copied!" : status === "error" ? "Couldn't copy" : "Copy available times"}
    </Button>
  );
}
