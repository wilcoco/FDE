"use client";

// Submit button that shows progress while its server action runs — a slow
// mail server must never look like "nothing happened".

import { useFormStatus } from "react-dom";

export default function PendingButton({
  children,
  pendingLabel,
  className = "btn w-full",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
