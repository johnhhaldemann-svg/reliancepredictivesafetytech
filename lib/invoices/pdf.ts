import "server-only";

// Invoice PDF rendering — pdf-lib, same reasoning as lib/proposals/pdf.ts:
// the browser's own "Print to PDF" bakes its page URL into every margin, and
// no CSS can suppress that in every browser, so this draws the document
// itself instead. Deliberately simpler than the proposal renderer — an
// invoice has one table and no phases, team bios or signatures — but reuses
// the same page geometry and brand colors so the two document families look
// like they came from the same company.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import type { InvoiceDocumentModel } from "./document-model";

const PAGE_WIDTH = 612; // US Letter at 72dpi
const PAGE_HEIGHT = 792;
const MARGIN_X = 44;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const NAVY = rgb(0.047, 0.204, 0.314);
const GOLD = rgb(0.788, 0.576, 0.169);
const INK = rgb(0.086, 0.141, 0.184);
const MUTED = rgb(0.35, 0.42, 0.49);
const RULE = rgb(0.78, 0.82, 0.855);
const BAND = rgb(0.945, 0.965, 0.98);

/** Folds smart punctuation to WinAnsi-safe ASCII — pdf-lib's standard fonts throw on unsupported glyphs. */
function toPdfText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xff]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = toPdfText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class Layout {
  doc: PDFDocument;
  fonts: { regular: PDFFont; bold: PDFFont };
  page!: PDFPage;
  y = 0;
  pageCount = 0;

  constructor(doc: PDFDocument, fonts: { regular: PDFFont; bold: PDFFont }) {
    this.doc = doc;
    this.fonts = fonts;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
    this.pageCount += 1;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN_BOTTOM) this.newPage();
  }

  text(value: string, options: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const size = options.size ?? 10;
    const font = options.font ?? this.fonts.regular;
    this.ensure(size + (options.gap ?? 4));
    this.page.drawText(toPdfText(value), { x: options.x ?? MARGIN_X, y: this.y - size, size, font, color: options.color ?? INK });
    this.y -= size + (options.gap ?? 4);
  }

  rule(color = RULE) {
    this.ensure(10);
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: PAGE_WIDTH - MARGIN_X, y: this.y }, thickness: 1, color });
    this.y -= 10;
  }
}

async function tryEmbedSeal(doc: PDFDocument) {
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", "reliance-seal-transparent.png"));
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

const COLS = [
  { key: "description", label: "Description", width: 0.46 },
  { key: "qty", label: "Qty", width: 0.1 },
  { key: "unit", label: "Unit", width: 0.16 },
  { key: "unitAmount", label: "Unit amount", width: 0.14 },
  { key: "lineTotal", label: "Amount", width: 0.14 },
] as const;

function colX(index: number): number {
  let x = MARGIN_X;
  for (let i = 0; i < index; i += 1) x += CONTENT_WIDTH * COLS[i].width;
  return x;
}

export async function renderInvoicePdf(model: InvoiceDocumentModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const layout = new Layout(doc, fonts);
  layout.newPage();

  const seal = await tryEmbedSeal(doc);
  const sealSize = 44;
  if (seal) {
    layout.page.drawImage(seal, { x: MARGIN_X, y: layout.y - sealSize + 10, width: sealSize, height: sealSize });
  }
  const textX = seal ? MARGIN_X + sealSize + 12 : MARGIN_X;
  layout.page.drawText(toPdfText(model.seller.name), { x: textX, y: layout.y - 10, size: 14, font: fonts.bold, color: NAVY });
  layout.page.drawText("INVOICE", { x: PAGE_WIDTH - MARGIN_X - fonts.bold.widthOfTextAtSize("INVOICE", 20), y: layout.y - 14, size: 20, font: fonts.bold, color: NAVY });
  layout.y -= 30;

  for (const line of model.seller.addressLines) {
    layout.text(line, { x: textX, size: 9, color: MUTED, gap: 2 });
  }
  if (model.seller.email || model.seller.phone) {
    layout.text([model.seller.email, model.seller.phone].filter(Boolean).join("  ·  "), { x: textX, size: 9, color: MUTED, gap: 2 });
  }

  const invoiceMetaX = PAGE_WIDTH - MARGIN_X - 200;
  let metaY = PAGE_HEIGHT - MARGIN_TOP - 30;
  const metaRow = (label: string, value: string | null) => {
    if (!value) return;
    layout.page.drawText(toPdfText(label), { x: invoiceMetaX, y: metaY, size: 9, font: fonts.bold, color: MUTED });
    layout.page.drawText(toPdfText(value), { x: invoiceMetaX + 70, y: metaY, size: 9, font: fonts.regular, color: INK });
    metaY -= 14;
  };
  metaRow("Invoice #", model.invoiceNumber);
  metaRow("Proposal #", model.proposalNumber);
  metaRow("Status", model.statusLabel);
  metaRow("Kind", model.kindLabel);
  metaRow("Issue date", model.issueDate);
  metaRow("Due date", model.dueDate);
  layout.y = Math.min(layout.y, metaY - 10);

  layout.rule(GOLD);
  layout.y -= 6;

  layout.text("BILL TO", { size: 9, font: fonts.bold, color: MUTED, gap: 4 });
  layout.text(model.billTo.name || "—", { size: 12, font: fonts.bold, color: NAVY, gap: 4 });
  for (const line of model.billTo.addressLines) layout.text(line, { size: 9.5, color: MUTED, gap: 2 });
  layout.y -= 8;

  const metaLine = (label: string, value: string | null) => {
    if (!value) return;
    layout.text(`${label}: ${value}`, { size: 9.5, color: MUTED, gap: 3 });
  };
  metaLine("Job / site", model.jobName);
  metaLine("Consultant", model.consultantName);
  metaLine("Client PO / agreement ref", model.clientAgreementRef);
  metaLine("Prepared by", model.preparedBy);
  layout.y -= 6;
  layout.rule();
  layout.y -= 4;

  // Table header
  const drawTableHeader = () => {
    layout.ensure(24);
    layout.page.drawRectangle({ x: MARGIN_X, y: layout.y - 18, width: CONTENT_WIDTH, height: 20, color: BAND });
    COLS.forEach((col, i) => {
      const x = colX(i) + (i === 0 ? 6 : 0);
      layout.page.drawText(toPdfText(col.label), { x, y: layout.y - 13, size: 9, font: fonts.bold, color: NAVY });
    });
    layout.y -= 24;
  };
  drawTableHeader();

  for (const line of model.lines) {
    const descLines = wrapText(line.description, fonts.regular, 9.5, CONTENT_WIDTH * COLS[0].width - 10);
    const rowHeight = Math.max(16, descLines.length * 12 + 4);
    layout.ensure(rowHeight);
    if (layout.y === PAGE_HEIGHT - MARGIN_TOP) drawTableHeader();

    const topY = layout.y;
    descLines.forEach((text, i) => {
      layout.page.drawText(toPdfText(text), { x: colX(0) + 6, y: topY - 11 - i * 12, size: 9.5, font: fonts.regular, color: INK });
    });
    layout.page.drawText(line.qty, { x: colX(1), y: topY - 11, size: 9.5, font: fonts.regular, color: INK });
    layout.page.drawText(line.unit, { x: colX(2), y: topY - 11, size: 9.5, font: fonts.regular, color: INK });
    layout.page.drawText(line.unitAmount, { x: colX(3), y: topY - 11, size: 9.5, font: fonts.regular, color: INK });
    layout.page.drawText(line.lineTotal, { x: colX(4), y: topY - 11, size: 9.5, font: fonts.bold, color: INK });
    layout.page.drawLine({ start: { x: MARGIN_X, y: topY - rowHeight + 4 }, end: { x: PAGE_WIDTH - MARGIN_X, y: topY - rowHeight + 4 }, thickness: 0.5, color: RULE });
    layout.y = topY - rowHeight;
  }

  layout.y -= 6;

  // Totals block, right-aligned
  const totalsX = PAGE_WIDTH - MARGIN_X - 200;
  const totalsValueX = PAGE_WIDTH - MARGIN_X;
  const totalRow = (label: string, value: string, bold = false) => {
    layout.ensure(16);
    const font = bold ? fonts.bold : fonts.regular;
    layout.page.drawText(toPdfText(label), { x: totalsX, y: layout.y - 11, size: bold ? 11 : 9.5, font, color: bold ? NAVY : MUTED });
    const width = font.widthOfTextAtSize(value, bold ? 11 : 9.5);
    layout.page.drawText(toPdfText(value), { x: totalsValueX - width, y: layout.y - 11, size: bold ? 11 : 9.5, font, color: bold ? NAVY : INK });
    layout.y -= bold ? 18 : 15;
  };
  totalRow("Subtotal", model.subtotal);
  totalRow("Tax", model.tax);
  layout.rule();
  totalRow("Total due", model.total, true);

  if (model.paymentTerms) {
    layout.y -= 10;
    layout.text("PAYMENT TERMS", { size: 9, font: fonts.bold, color: MUTED, gap: 4 });
    for (const wrapped of wrapText(model.paymentTerms, fonts.regular, 9.5, CONTENT_WIDTH)) {
      layout.text(wrapped, { size: 9.5, color: INK, gap: 2 });
    }
  }

  if (model.notes) {
    layout.y -= 10;
    layout.text("NOTES", { size: 9, font: fonts.bold, color: MUTED, gap: 4 });
    for (const wrapped of wrapText(model.notes, fonts.regular, 9.5, CONTENT_WIDTH)) {
      layout.text(wrapped, { size: 9.5, color: INK, gap: 2 });
    }
  }

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const footer = `Page ${index + 1} of ${pages.length}`;
    page.drawText(footer, {
      x: PAGE_WIDTH - MARGIN_X - fonts.regular.widthOfTextAtSize(footer, 8),
      y: 30,
      size: 8,
      font: fonts.regular,
      color: MUTED,
    });
  });

  return doc.save();
}
