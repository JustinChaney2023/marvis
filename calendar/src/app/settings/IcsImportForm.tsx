"use client";

import { useRef, useState } from "react";
import { importIcsAction } from "../actions";
import Button from "../ui/Button";

export default function IcsImportForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (formData: FormData) => {
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await importIcsAction(formData);
      setMessage(result.ok ? `Imported ${result.imported} event(s).` : result.error);
      if (result.ok) formRef.current?.reset();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form ref={formRef} action={handleSubmit} className="flex items-center gap-2">
      <input
        type="file"
        name="file"
        accept=".ics,text/calendar"
        required
        className="text-sm text-ink-2"
      />
      <Button type="submit" variant="secondary" pending={isSubmitting}>
        Import
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </form>
  );
}
