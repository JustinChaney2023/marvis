"use client";

import { useEffect, useState } from "react";
import { polishAgenda } from "./actions";

export default function AgendaText({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    let live = true;
    polishAgenda()
      .then((t) => live && setText(t))
      .catch(() => {}); // the template is already on screen
    return () => {
      live = false;
    };
  }, []);
  return <p className="font-serif text-lg italic text-ink-2">{text}</p>;
}
