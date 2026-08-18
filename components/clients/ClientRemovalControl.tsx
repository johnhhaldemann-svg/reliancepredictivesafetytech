"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { removeClientFromLifecycle, restoreClientToLifecycle } from "@/app/employee/clients/actions";

/**
 * The Remove / Restore button on a company.
 *
 * A client component for one reason: removal needs a confirmation step, and a
 * company leaving the board is not something to do on a stray click. The write
 * itself is still a Server Action — nothing here talks to Supabase from the
 * browser (CLAUDE.md, architectural conventions).
 *
 * Restore is deliberately NOT confirmed. It is the undo, and putting a
 * roadblock in front of undo is what makes people afraid of the remove button.
 */

type ClientRemovalControlProps = {
  clientId: string;
  clientName: string;
  /** Current state of the company, which decides which action this offers. */
  removed: boolean;
  /** False when the viewer's role may not change the lifecycle; renders nothing. */
  allowed: boolean;
  /** `compact` is the directory row; `full` is the company record banner. */
  variant?: "compact" | "full";
};

export function ClientRemovalControl({
  clientId,
  clientName,
  removed,
  allowed,
  variant = "compact",
}: ClientRemovalControlProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (!allowed) return null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work. Try again.");
        return;
      }
      setConfirming(false);
      // The action revalidates the server-rendered list; this pulls it in
      // without a full navigation, so the row disappears in place.
      router.refresh();
    });
  }

  if (removed) {
    return (
      <span className="client-removal-control">
        <button
          className={variant === "full" ? "button button-primary" : "button button-light"}
          disabled={pending}
          onClick={() => run(() => restoreClientToLifecycle(clientId))}
          type="button"
        >
          <RotateCcw size={14} /> {pending ? "Restoring…" : "Restore"}
        </button>
        {error ? <span className="client-removal-error" role="alert">{error}</span> : null}
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="client-removal-control">
        <span className="client-removal-prompt">Remove {clientName}?</span>
        <button
          className="button button-danger"
          disabled={pending}
          onClick={() => run(() => removeClientFromLifecycle(clientId))}
          type="button"
        >
          {pending ? "Removing…" : "Yes, remove"}
        </button>
        <button className="button button-light" disabled={pending} onClick={() => setConfirming(false)} type="button">
          Cancel
        </button>
        {error ? <span className="client-removal-error" role="alert">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="client-removal-control">
      <button
        aria-label={`Remove ${clientName} from the client lifecycle`}
        className="button button-light"
        onClick={() => setConfirming(true)}
        type="button"
      >
        <Trash2 size={14} /> Remove
      </button>
      {error ? <span className="client-removal-error" role="alert">{error}</span> : null}
    </span>
  );
}
