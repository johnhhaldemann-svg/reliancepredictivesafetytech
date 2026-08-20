"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteInvoice } from "@/app/employee/invoices/actions";

export function InvoiceDeleteButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return;
    setError("");
    startTransition(async () => {
      const result = await deleteInvoice(invoiceId);
      if (!result.ok) {
        setError(result.error ?? "Could not delete this invoice.");
        return;
      }
      router.push("/employee/invoices");
      router.refresh();
    });
  }

  return (
    <div className="form-panel" style={{ marginTop: 20 }}>
      <h2>Danger zone</h2>
      {error ? <div className="success-box portal-alert portal-alert-error">{error}</div> : null}
      <button
        type="button"
        className="button button-light"
        style={{ marginTop: 12, color: "#ef4444" }}
        disabled={isPending}
        onClick={handleDelete}
      >
        <Trash2 size={16} /> {isPending ? "Deleting…" : "Delete invoice"}
      </button>
    </div>
  );
}
