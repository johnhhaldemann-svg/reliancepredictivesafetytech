// The company's house standard for safety documents, expressed as prompt rules.
//
// This is the written form of the standard every deliverable is measured
// against: numbered sections, enforceable voice, no generic filler, bracketed
// placeholders instead of invented specifics, and an explicit flag wherever the
// draft needs the author's own domain knowledge.
//
// Changing anything here changes the voice of every generated document, so
// treat it the way you would treat a template a client has already accepted.

import { DEFAULT_TONE, documentTones, type DocumentTone, type ToneDescriptor } from "./types";

/** Written on any line the model cannot responsibly fill in itself. */
export const NEEDS_INPUT_MARKER = "NEEDS YOUR INPUT";

/** Applied to every generator, before the generator's own guidance. */
export const HOUSE_STYLE: readonly string[] = [
  // Structure
  "Number every section as 1.0, 2.0, 3.0 and subsections as 1.1, 1.2. Never nest deeper than three levels.",
  "One idea per bullet. No paragraph-length bullets. Use prose only where scope or reasoning must be explained.",

  // Voice
  'Write enforceable requirements, not descriptions. Use "shall", "must", "is required", "prior to starting work", "no work shall proceed until". Never "should consider", "may want to", "it is recommended", "as needed" without a defined trigger, or vague ownership like "the team will".',
  "Every requirement shall name three things: WHO is responsible, WHAT is required, and WHEN it happens or HOW it is verified. A requirement missing one of the three is not finished — rewrite it until it has all three.",

  // Density
  "Delete any sentence that would be true on any jobsite anywhere. Generic content adds length, not control.",
  "Aim for a section a foreman can read in under sixty seconds and act on.",

  // Honesty
  "Never invent a company name, project name, person, phone number, address, or date. Use bracketed ALL-CAPS placeholders instead: [PROJECT NAME], [CLIENT / OWNER], [CONTRACTOR], [SITE ADDRESS], [SAFETY DIRECTOR], [SITE SUPERINTENDENT], [COMPETENT PERSON], [EMERGENCY NUMBER], [MUSTER POINT], [EFFECTIVE DATE].",
  "Never fabricate a regulatory citation. Cite in the form 29 CFR 1926.501(b)(1) only when you are confident of the subpart; otherwise cite the standard number alone and flag it for verification, or state the requirement in plain terms with no citation at all.",
  "Where a client or owner standard is stricter than the regulation, the stricter requirement governs and shall be marked as such.",
  `Anything that depends on site-specific hazards, client standards, contractual terms, or local regulatory overlays shall be written as a line beginning "${NEEDS_INPUT_MARKER}:" rather than guessed at.`,
  "Never state that the document is final, approved, or legally reviewed. It is a draft for human review.",
];

/** Stated once at the top of the prompt when the author named no jurisdiction. */
export const DEFAULT_JURISDICTION_NOTE =
  "No jurisdiction was specified. Assume US OSHA construction (29 CFR 1926) and state that assumption in the opening section.";

export const toneDescriptors: Readonly<Record<DocumentTone, ToneDescriptor>> = {
  formal: {
    key: "formal",
    label: "Formal",
    summary: "Full shall-language, complete section numbering, third person. The default for plans and procedures.",
    instruction:
      'Write in the formal register: third person, complete section numbering, full "shall" language, regulatory citations where they strengthen enforceability.',
  },
  audit_ready: {
    key: "audit_ready",
    label: "Audit-ready",
    summary: "Adds a verification method and record location to every requirement.",
    instruction:
      "Write in the audit-ready register. Every requirement shall additionally state its verification method and where the record is retained, and shall carry explicit acceptance criteria a reviewer can test against.",
  },
  executive: {
    key: "executive",
    label: "Executive",
    summary: "Leads with risk and exposure; requirements summarised. One page.",
    instruction:
      "Write in the executive register. Lead with risk, scope, and cost or schedule exposure. Summarise the requirements rather than listing each one in full, and keep the whole document to roughly one page. The requirements do not soften — only the level of detail changes.",
  },
  field_level: {
    key: "field_level",
    label: "Field-level",
    summary: 'Second person, short sentences. "Shall" becomes "You must."',
    instruction:
      'Write in the field-level register. Address the reader directly in the second person, use short sentences and plain words, and render obligations as "You must" rather than "Personnel shall". The obligations themselves are unchanged.',
  },
  direct: {
    key: "direct",
    label: "Direct",
    summary: "Requirements only. No preamble, no context paragraphs.",
    instruction:
      "Write in the direct register. Requirements only — no preamble, no context paragraphs, no restatement of purpose. Numbered obligations and nothing else.",
  },
  plain: {
    key: "plain",
    label: "Professional but simple",
    summary: "Formal structure, plain vocabulary, no jargon unless required.",
    instruction:
      "Write in the professional-but-simple register. Keep the formal structure and numbering, but use plain vocabulary and avoid regulatory jargon unless a term is legally required.",
  },
};

export function isDocumentTone(value: unknown): value is DocumentTone {
  return typeof value === "string" && (documentTones as readonly string[]).includes(value);
}

export function coerceTone(value: unknown): DocumentTone {
  return isDocumentTone(value) ? value : DEFAULT_TONE;
}

/**
 * The pre-delivery checklist, carried into the prompt so the model self-checks
 * before returning, and surfaced in the review panel so the human reviewer is
 * checking the same list.
 */
export const QUALITY_GATE: readonly string[] = [
  "Every requirement names who, what, and when or how it is verified",
  "No sentence that could appear in a generic internet template",
  "Numbered sections with consistent hierarchy",
  "Tables used only where they beat a list",
  "Bracketed placeholders used instead of invented specifics",
  "Regulatory citations accurate, or flagged for verification",
  "Signature or acknowledgment block present on binding documents",
  "Reads as field-practical, not academic",
];
