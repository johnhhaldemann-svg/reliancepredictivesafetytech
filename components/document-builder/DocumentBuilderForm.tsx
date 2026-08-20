"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import {
  DEFAULT_TONE,
  coreFields,
  documentTones,
  generatorsByGroup,
  getGenerator,
  toneDescriptors,
  type GeneratorField,
} from "@/lib/documents/generators";

export interface DocumentBuilderClientOption {
  id: string;
  name: string;
}

const GROUPED = generatorsByGroup();
const FIRST_KEY = GROUPED[0]?.generators[0]?.key ?? "sop";

/** Renders one generator-specific input. Guidance lives in the placeholder, never in the value. */
function SpecField({ field }: { field: GeneratorField }) {
  const id = `detail_${field.key}`;
  const name = `detail_${field.key}`;

  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? null : <span style={{ color: "var(--portal-muted)", fontWeight: 400 }}> (optional)</span>}
      </label>
      {field.kind === "textarea" ? (
        <textarea id={id} name={name} rows={3} placeholder={field.placeholder} required={field.required} />
      ) : field.kind === "select" ? (
        <select id={id} name={name} defaultValue="" required={field.required}>
          <option value="">Select…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} name={name} placeholder={field.placeholder} required={field.required} />
      )}
    </div>
  );
}

export function DocumentBuilderForm({ clients = [] }: { clients?: DocumentBuilderClientOption[] }) {
  const router = useRouter();
  const [docType, setDocType] = useState<string>(FIRST_KEY);
  const [tone, setTone] = useState<string>(DEFAULT_TONE);
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const spec = useMemo(() => getGenerator(docType), [docType]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const text = (key: string) => String(formData.get(key) ?? "").trim();

    // Generator-specific answers travel in `details`, keyed by the spec's field
    // keys, so adding a field to a spec never means changing this component.
    const details: Record<string, string> = {};
    for (const field of spec?.fields ?? []) {
      const value = text(`detail_${field.key}`);
      if (value) details[field.key] = value;
    }

    const payload = {
      doc_type: docType,
      tone,
      title: text("title"),
      // Optional. When set, the server fills industry and jurisdiction from the
      // client record for any field left blank, and briefs the model on what the
      // platform already knows about them.
      client_id: text("client_id") || null,
      industry: text("industry"),
      jurisdiction: text("jurisdiction"),
      scope: text("scope"),
      hazards: text("hazards"),
      responsible_role: text("responsible_role"),
      company_standards: text("company_standards"),
      notes: text("notes"),
      details,
    };

    if (!payload.title) {
      setSubmitting(false);
      setError("Give the document a title.");
      return;
    }

    try {
      const res = await fetch("/api/document-builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generation failed.");
        setSubmitting(false);
        return;
      }
      router.push(`/employee/document-builder/${data.draftId}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <h2>Generate a document</h2>
      <p style={{ color: "var(--portal-muted)", marginTop: 4, fontSize: "0.9rem" }}>
        Every draft lands in review. A person approves it before it can be published.
      </p>
      {error ? <div className="error-box" style={{ marginTop: 12 }}>{error}</div> : null}

      <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
        <div className="field">
          <label htmlFor="doc_type">What are you making?</label>
          <select id="doc_type" name="doc_type" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {GROUPED.map(({ group, generators }) => (
              <optgroup key={group} label={group}>
                {generators.map((generator) => (
                  <option key={generator.key} value={generator.key}>
                    {generator.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {spec ? <small style={{ color: "var(--portal-muted)" }}>{spec.summary}</small> : null}
        </div>

        <div className="field">
          <label htmlFor="tone">Tone</label>
          <select id="tone" name="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
            {documentTones.map((key) => (
              <option key={key} value={key}>
                {toneDescriptors[key].label}
              </option>
            ))}
          </select>
          <small style={{ color: "var(--portal-muted)" }}>{toneDescriptors[tone as keyof typeof toneDescriptors]?.summary}</small>
        </div>

        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" placeholder={spec?.titlePlaceholder} required />
        </div>

        {(spec?.fields ?? []).map((field) => (
          <SpecField key={`${docType}_${field.key}`} field={field} />
        ))}

        {clients.length > 0 ? (
          <div className="field">
            <label htmlFor="client_id">Who is it for? (optional)</label>
            <select id="client_id" name="client_id" defaultValue="">
              <option value="">Not client-specific</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <small style={{ color: "var(--portal-muted)" }}>
              Picking a client fills in their industry and jurisdiction, and tells the AI what we already know about
              them.
            </small>
          </div>
        ) : null}

        <button
          type="button"
          className="button button-light"
          style={{ justifySelf: "start" }}
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? "Hide extra detail" : "Add more detail (optional)"}
        </button>

        {showMore ? (
          <>
            {coreFields.map((core) =>
              core.kind === "textarea" ? (
                <div className="field" key={core.key}>
                  <label htmlFor={core.key}>{core.label}</label>
                  <textarea id={core.key} name={core.key} rows={2} placeholder={core.placeholder} />
                </div>
              ) : (
                <div className="field" key={core.key}>
                  <label htmlFor={core.key}>{core.label}</label>
                  <input id={core.key} name={core.key} placeholder={core.placeholder} />
                </div>
              ),
            )}
          </>
        ) : null}

        <button className="button button-primary" disabled={submitting} type="submit" style={{ justifySelf: "start" }}>
          {submitting ? <Loader2 size={18} className="spin" /> : <FilePlus2 size={18} />}
          {submitting ? "Generating… (20–40s)" : "Generate Draft"}
        </button>
      </div>
    </form>
  );
}
