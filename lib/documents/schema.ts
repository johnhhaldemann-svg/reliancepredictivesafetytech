// Pure (no server-only / OpenAI) helpers for the document generation pipeline so
// they can be unit-tested directly. The OpenAI orchestration that uses these lives
// in builder.ts (generateSafetyDocument).
//
// The prompt is assembled from three layers, in this order:
//   1. HOUSE_STYLE       — how every company document is written
//   2. the tone variant  — which register this one is written in
//   3. the generator spec — what this document is, and its own drafting rules
// Nothing about a specific document kind is hardcoded here.

import {
  DEFAULT_DOCUMENT_DISCLAIMER,
  docConfidenceLevels,
  type DocConfidenceLevel,
  type DocType,
  type DocumentBuilderInput,
  type DocumentSection,
  type GeneratedDocument,
} from "./types";
import {
  DEFAULT_JURISDICTION_NOTE,
  HOUSE_STYLE,
  QUALITY_GATE,
  coerceTone,
  coreFields,
  getGenerator,
  toneDescriptors,
  type GeneratorSpec,
} from "./generators";

function numbered(lines: readonly string[]): string {
  return lines.map((line) => `  - ${line}`).join("\n");
}

/**
 * The full instruction block for one generator in one tone. Exported for the
 * registry test, which renders every spec to catch a generator whose guidance
 * or section list would produce an unusable prompt.
 */
export function documentSystemPrompt(docType: DocType, tone?: string): string {
  const spec = getGenerator(docType);
  if (!spec) {
    // An unregistered key should never reach here — the route validates first —
    // but a generic instruction beats throwing inside a prompt builder.
    return `You are a senior safety professional drafting a clear, practical, audit-ready document.\n\nHOUSE STYLE — these rules apply to every document:\n${numbered(HOUSE_STYLE)}`;
  }
  return renderSystemPrompt(spec, tone);
}

function renderSystemPrompt(spec: GeneratorSpec, tone?: string): string {
  const toneDescriptor = toneDescriptors[coerceTone(tone)];
  const sectionList = spec.sections.map((section, index) => `  ${index + 1}.0  ${section}`).join("\n");

  const parts = [
    `You are a senior safety professional drafting a ${spec.documentKind} for a construction safety program.`,
    `HOUSE STYLE — these rules apply to every document this company produces:\n${numbered(HOUSE_STYLE)}`,
    `REGISTER — ${toneDescriptor.label}: ${toneDescriptor.instruction}`,
    `REQUIRED SECTIONS — produce these in this order, and add others only where genuinely useful:\n${sectionList}`,
    `DOCUMENT-SPECIFIC RULES:\n${numbered(spec.guidance)}`,
  ];

  if (spec.fieldUse) {
    parts.push(
      "FIELD USE — this document is read standing on a jobsite, not at a desk. Keep lines short, put one requirement per line, and prefer a checkbox line over a paragraph wherever something gets verified.",
    );
  }

  parts.push(
    `For each section, write the prose in "body" and put discrete steps, duties, requirements, or checklist items in "items" (use an empty array when a section is purely prose).`,
    `Set confidence_level to:
  - high: routine, well-established safety practice you are confident about
  - medium: generally correct but the site shall verify specifics
  - low: depends heavily on site conditions or equipment not fully described
  - needs_review: involves legal interpretation, engineering judgement, or unclear applicability`,
    `Put anything a qualified human MUST verify before approval into review_notes.`,
    `Before returning, check the draft against this quality gate and fix anything that fails:\n${numbered(QUALITY_GATE)}`,
  );

  return parts.join("\n\n");
}

function field(description: string, enumValues?: readonly string[]) {
  return enumValues ? { type: "string", description, enum: [...enumValues] } : { type: "string", description };
}

const sectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    heading: field("Section heading, e.g. '1.0 Purpose'"),
    body: field("Section prose. Empty string if the section is purely a list."),
    items: { type: "array", description: "Discrete steps/duties/requirements/checklist items, or empty array", items: { type: "string" } },
  },
  required: ["heading", "body", "items"],
} as const;

export const documentResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: field("Official document title"),
    summary: field("1-2 sentence summary of what this document covers"),
    sections: { type: "array", items: sectionSchema },
    review_notes: { type: "array", items: { type: "string" } },
    confidence_level: field("Overall confidence", docConfidenceLevels),
    disclaimer: field("The fixed safety document disclaimer"),
  },
  required: ["title", "summary", "sections", "review_notes", "confidence_level", "disclaimer"],
} as const;

/** Renders the author's answers into the request block. Blank answers are omitted entirely. */
export function buildDocumentRequest(input: DocumentBuilderInput): string {
  const lines: string[] = [];
  const add = (label: string, value?: string | null) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    lines.push(`- ${label}: ${String(value).trim()}`);
  };

  add("Document title", input.title);

  const spec = getGenerator(input.doc_type);
  // Generator-specific answers come first: they are the substance of the
  // request, and the core fields qualify them.
  for (const specField of spec?.fields ?? []) {
    add(specField.promptLabel ?? specField.label, input.details?.[specField.key]);
  }
  for (const core of coreFields) {
    add(core.promptLabel, input[core.key]);
  }

  return lines.join("\n");
}

export function buildDocumentPrompt(input: DocumentBuilderInput, clientContextBlock?: string): string {
  const spec = getGenerator(input.doc_type);

  // The client briefing sits between the instructions and the request, so the
  // model reads who this is for before what is being asked. Absent when no
  // client was chosen, in which case the prompt is exactly as it was.
  const contextSection = clientContextBlock?.trim() ? `\n\n${clientContextBlock.trim()}` : "";
  const jurisdictionNote = input.jurisdiction?.trim() ? "" : `\n\n${DEFAULT_JURISDICTION_NOTE}`;
  const label = spec?.label ?? "document";

  return `${documentSystemPrompt(input.doc_type, input.tone)}${jurisdictionNote}${contextSection}

DOCUMENT REQUEST:
${buildDocumentRequest(input)}

Draft the complete ${label} now as structured sections.`;
}

// ---- parsing + normalization -------------------------------------------------

/**
 * Defensive fallback: extract the first complete, balanced JSON object from
 * arbitrary text (handles markdown fences and surrounding prose).
 */
export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  let t = text.trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const start = t.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

function coerceConfidence(value: unknown): DocConfidenceLevel {
  const v = str(value).trim().toLowerCase().replace(/\s+/g, "_");
  return (docConfidenceLevels as readonly string[]).includes(v) ? (v as DocConfidenceLevel) : "needs_review";
}

function normalizeSection(s: Record<string, unknown>): DocumentSection {
  return {
    heading: str(s.heading),
    body: str(s.body),
    items: Array.isArray(s.items) ? s.items.map(str).filter((x) => x.trim() !== "") : [],
  };
}

/**
 * Normalizes parsed model output into a validated GeneratedDocument.
 * Returns null only when there is no usable content (no title or no sections).
 */
export function normalizeDocument(
  parsed: Record<string, unknown> | null | undefined,
  docType: DocType,
): GeneratedDocument | null {
  if (!parsed || typeof parsed !== "object") return null;

  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map(normalizeSection)
    .filter((s) => s.heading.trim() !== "" && (s.body.trim() !== "" || s.items.length > 0));

  const title = str(parsed.title);
  if (!title || sections.length === 0) return null;

  return {
    doc_type: docType,
    title,
    summary: str(parsed.summary),
    sections,
    review_notes: Array.isArray(parsed.review_notes) ? parsed.review_notes.map(str).filter(Boolean) : [],
    confidence_level: coerceConfidence(parsed.confidence_level),
    // Always pin the fixed disclaimer regardless of what the model returned.
    disclaimer: DEFAULT_DOCUMENT_DISCLAIMER,
  };
}

/** Serialize a document to Markdown — used for storage, preview, and gateway text. */
export function documentToMarkdown(doc: GeneratedDocument): string {
  const parts: string[] = [`# ${doc.title}`];
  if (doc.summary) parts.push(doc.summary);
  for (const section of doc.sections) {
    parts.push(`## ${section.heading}`);
    if (section.body) parts.push(section.body);
    for (const item of section.items) parts.push(`- ${item}`);
  }
  if (doc.review_notes.length) {
    parts.push("## Review Notes");
    for (const note of doc.review_notes) parts.push(`- ${note}`);
  }
  return parts.join("\n\n");
}

/** Parse raw model text into a GeneratedDocument, with a defensive JSON-extraction fallback. */
export function parseDocumentOutput(text: string, docType: DocType): GeneratedDocument | null {
  try {
    return normalizeDocument(JSON.parse(text.trim()), docType);
  } catch {
    // fall through to defensive extraction
  }
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    return normalizeDocument(JSON.parse(jsonText), docType);
  } catch {
    return null;
  }
}
