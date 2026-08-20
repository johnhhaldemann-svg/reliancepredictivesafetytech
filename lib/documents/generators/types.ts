// Declarative generator specs for the Document Builder.
//
// Before this file the builder shipped two hardcoded document kinds ("sop",
// "policy") with their section lists baked into a prompt function. Every new
// kind of document the company generates — a JSA, a permit, an offer letter —
// meant editing four files and a CHECK constraint.
//
// A generator is now DATA: what it is called, what the model is told to write,
// which sections it must contain, which fields the form collects, and whether a
// human must approve the result before it can leave the platform. Adding one is
// a registry entry plus a migration that widens the doc_type check.

/** Where a generator sits in the picker, and who normally runs it. */
export const generatorGroups = [
  "Field Safety",
  "Safety Program",
  "Governance",
  "Commercial",
  "People",
] as const;
export type GeneratorGroup = (typeof generatorGroups)[number];

export const generatorFieldKinds = ["text", "textarea", "select", "date"] as const;
export type GeneratorFieldKind = (typeof generatorFieldKinds)[number];

/** One input the form collects for a generator, on top of the shared core fields. */
export interface GeneratorField {
  /** Stored under inputs.details[key]. snake_case. */
  key: string;
  label: string;
  kind: GeneratorFieldKind;
  /** Guidance lives here, never as a pre-filled value — see lib/guardrails/generator-asset-prefill.test.ts. */
  placeholder?: string;
  required?: boolean;
  /** Required when kind is "select". */
  options?: readonly string[];
  /** Label used when this value is rendered into the model request. Defaults to `label`. */
  promptLabel?: string;
}

export interface GeneratorSpec {
  /** Stored as document_builder_drafts.doc_type. snake_case, stable, never reused. */
  key: string;
  label: string;
  group: GeneratorGroup;
  /** One line shown under the label in the picker. */
  summary: string;
  /** What the model is told it is drafting, e.g. "Job Safety Analysis (JSA)". */
  documentKind: string;
  /** Minimum sections the draft must contain, in order. */
  sections: readonly string[];
  /** Drafting rules appended to the shared house style. */
  guidance: readonly string[];
  /** Spec-specific inputs. */
  fields: readonly GeneratorField[];
  /**
   * Human Authority Rule (CLAUDE.md). True means the draft cannot be published
   * until a human reviewer approves it. Anything that carries legal weight,
   * authorises work, disciplines a person, or is signed in the field is true.
   */
  humanReviewRequired: boolean;
  /**
   * A document a worker reads standing on a jobsite, not sitting at a desk.
   * Renders larger type, shorter lines, and no dense prose blocks.
   */
  fieldUse?: boolean;
  titlePlaceholder: string;
}

/** Fields every generator collects. Stored as top-level keys on DocumentBuilderInput. */
export interface CoreFieldDescriptor {
  key: "scope" | "hazards" | "company_standards" | "industry" | "jurisdiction" | "responsible_role" | "notes";
  label: string;
  promptLabel: string;
  kind: GeneratorFieldKind;
  placeholder: string;
}

export const coreFields: readonly CoreFieldDescriptor[] = [
  {
    key: "scope",
    label: "Scope / activity covered",
    promptLabel: "Scope / activity covered",
    kind: "textarea",
    placeholder: "What work, area, crew, or equipment this covers — and what it does not",
  },
  {
    key: "hazards",
    label: "Known hazards",
    promptLabel: "Known hazards",
    kind: "textarea",
    placeholder: "Hazards already identified on this task or site",
  },
  {
    key: "industry",
    label: "Industry / operation",
    promptLabel: "Industry / operation",
    kind: "text",
    placeholder: "e.g. pharmaceutical construction, industrial maintenance",
  },
  {
    key: "jurisdiction",
    label: "Jurisdiction",
    promptLabel: "Jurisdiction",
    kind: "text",
    placeholder: "e.g. Indiana / federal OSHA",
  },
  {
    key: "responsible_role",
    label: "Responsible role / owner",
    promptLabel: "Responsible role / owner",
    kind: "text",
    placeholder: "e.g. Site Safety Director, competent person",
  },
  {
    key: "company_standards",
    label: "Company or client standards to incorporate",
    promptLabel: "Company standards to incorporate",
    kind: "textarea",
    placeholder: "Owner requirements, contractor expectations, internal standards that govern this work",
  },
  {
    key: "notes",
    label: "Additional notes",
    promptLabel: "Additional notes",
    kind: "textarea",
    placeholder: "Anything else the draft must account for",
  },
] as const;

// ---------------------------------------------------------------------------
// Tone variants
// ---------------------------------------------------------------------------
// The same requirements, framed for a different reader. Requirements never
// soften between variants — only the framing changes. A tone is recorded on the
// draft so a document can be filed correctly and re-rendered in another
// register without re-running the analysis.

export const documentTones = ["formal", "audit_ready", "executive", "field_level", "direct", "plain"] as const;
export type DocumentTone = (typeof documentTones)[number];

export const DEFAULT_TONE: DocumentTone = "formal";

export interface ToneDescriptor {
  key: DocumentTone;
  label: string;
  /** Shown in the picker so the person choosing knows what changes. */
  summary: string;
  /** Appended to the prompt. */
  instruction: string;
}
