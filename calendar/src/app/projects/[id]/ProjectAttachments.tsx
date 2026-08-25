"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addProjectAttachmentAction, deleteProjectAttachmentAction } from "../../actions";
import { CloseIcon } from "../../icons";

type Attachment = { id: string; filename: string; storedPath: string; sizeBytes: number };

export default function ProjectAttachments({
  projectId,
  attachments,
}: {
  projectId: string;
  attachments: Attachment[];
}) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/uploads/attachments", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      await addProjectAttachmentAction(projectId, data);
      router.refresh();
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async (attachmentId: string) => {
    await deleteProjectAttachmentAction(attachmentId);
    router.refresh();
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-rule px-2.5 py-1.5 text-sm"
            >
              <a
                href={`/uploads/${a.storedPath}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent hover:underline"
              >
                {a.filename}
              </a>
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                className="text-muted hover:text-accent"
                aria-label={`Remove ${a.filename}`}
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
        disabled={isUploading}
        className="text-sm text-ink-2"
      />
      {error && <span className="text-xs text-accent">{error}</span>}
    </div>
  );
}
