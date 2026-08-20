/** Mirrors lib/proposals/downloads.ts's slugging so both document families name files the same way. */
export function invoiceDownloadSlug(invoiceNumber: string): string {
  const slug = invoiceNumber
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "invoice").slice(0, 60);
}

export function invoiceDownloadFilename(invoiceNumber: string, extension: "pdf" | "docx"): string {
  return `${invoiceDownloadSlug(invoiceNumber)}.${extension}`;
}
