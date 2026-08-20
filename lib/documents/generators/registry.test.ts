import { describe, expect, it } from "vitest";
import { buildDocumentPrompt, documentSystemPrompt } from "../schema";
import { generatorRegistry } from "./registry";
import { HOUSE_STYLE, NEEDS_INPUT_MARKER, QUALITY_GATE, coerceTone, toneDescriptors } from "./house-style";
import { generatorKeys, generatorLabels, generatorsByGroup, getGenerator, isGeneratorKey, requireGenerator } from "./index";
import { documentTones, generatorGroups } from "./types";

describe("generator registry integrity", () => {
  it("has no duplicate keys", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const spec of generatorRegistry) {
      if (seen.has(spec.key)) duplicates.push(spec.key);
      seen.add(spec.key);
    }
    expect(duplicates).toEqual([]);
  });

  it("keeps the original two keys, so existing drafts keep their labels", () => {
    // 'sop' and 'policy' are in the database on real rows. Renaming either one
    // would orphan those drafts behind a label lookup that returns undefined.
    expect(generatorKeys).toContain("sop");
    expect(generatorKeys).toContain("policy");
  });

  it("uses snake_case keys only", () => {
    const offenders = generatorRegistry.filter((spec) => !/^[a-z][a-z0-9_]*$/.test(spec.key)).map((s) => s.key);
    expect(offenders).toEqual([]);
  });

  it("gives every generator a group the picker knows how to render", () => {
    const offenders = generatorRegistry
      .filter((spec) => !generatorGroups.includes(spec.group))
      .map((spec) => spec.key);
    expect(offenders).toEqual([]);
  });

  it("gives every generator sections, guidance, a summary and a title placeholder", () => {
    const incomplete = generatorRegistry
      .filter(
        (spec) =>
          spec.sections.length === 0 ||
          spec.guidance.length === 0 ||
          spec.summary.trim() === "" ||
          spec.titlePlaceholder.trim() === "",
      )
      .map((spec) => spec.key);
    expect(incomplete).toEqual([]);
  });

  it("never ships a duplicate field key within one generator", () => {
    const offenders: string[] = [];
    for (const spec of generatorRegistry) {
      const keys = spec.fields.map((f) => f.key);
      if (new Set(keys).size !== keys.length) offenders.push(spec.key);
    }
    expect(offenders).toEqual([]);
  });

  it("gives every select field options to select from", () => {
    const offenders: string[] = [];
    for (const spec of generatorRegistry) {
      for (const field of spec.fields) {
        if (field.kind === "select" && (field.options ?? []).length === 0) {
          offenders.push(`${spec.key}.${field.key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("puts guidance in placeholders, never in a default value", () => {
    // A value baked into a field is autosaved and prints on the finished
    // document as though a person wrote it — the defect
    // lib/guardrails/generator-asset-prefill.test.ts exists to prevent. The
    // GeneratorField type has no `value`, so this asserts the shape stays that
    // way if someone adds one.
    for (const spec of generatorRegistry) {
      for (const field of spec.fields) {
        expect(field).not.toHaveProperty("value");
        expect(field).not.toHaveProperty("defaultValue");
      }
    }
  });

  it("requires human review on everything that authorises work or affects a person", () => {
    // These are the documents where an unreviewed AI draft leaving the platform
    // is a real-world problem, not a quality one.
    const mustBeGated = [
      "jsa",
      "daily_activity_plan",
      "permit_package",
      "corrective_action_notice",
      "incident_investigation",
      "site_safety_plan",
      "contractor_expectations",
      "safety_coverage_plan",
      "emergency_action_plan",
      "sop",
      "policy",
      "scope_of_work",
      "pilot_agreement",
      "job_description",
      "offer_letter",
      "performance_review",
      "disciplinary_notice",
    ];
    const ungated = mustBeGated.filter((key) => requireGenerator(key).humanReviewRequired !== true);
    expect(ungated).toEqual([]);
  });
});

describe("registry lookups", () => {
  it("resolves every key and rejects unknown ones", () => {
    for (const key of generatorKeys) expect(getGenerator(key)?.key).toBe(key);
    expect(getGenerator("not_a_generator")).toBeNull();
    expect(getGenerator(null)).toBeNull();
    expect(getGenerator(undefined)).toBeNull();
    expect(isGeneratorKey("jsa")).toBe(true);
    expect(isGeneratorKey("not_a_generator")).toBe(false);
    expect(() => requireGenerator("not_a_generator")).toThrow(/Unknown document generator/);
  });

  it("labels every key", () => {
    for (const key of generatorKeys) expect(generatorLabels[key]).toBeTruthy();
  });

  it("groups every generator exactly once", () => {
    const grouped = generatorsByGroup().flatMap((entry) => entry.generators.map((g) => g.key));
    expect(grouped.sort()).toEqual([...generatorKeys].sort());
  });
});

describe("tones", () => {
  it("describes every tone", () => {
    for (const tone of documentTones) {
      expect(toneDescriptors[tone].instruction).toBeTruthy();
      expect(toneDescriptors[tone].summary).toBeTruthy();
    }
  });

  it("falls back to the default rather than throwing on junk", () => {
    expect(coerceTone("executive")).toBe("executive");
    expect(coerceTone("shouty")).toBe("formal");
    expect(coerceTone(undefined)).toBe("formal");
    expect(coerceTone(42)).toBe("formal");
  });
});

describe("every generator renders a usable prompt", () => {
  it("carries the house style, the quality gate, and its own sections and guidance", () => {
    for (const spec of generatorRegistry) {
      const prompt = documentSystemPrompt(spec.key);
      expect(prompt).toContain(spec.documentKind);
      for (const section of spec.sections) expect(prompt).toContain(section);
      for (const rule of spec.guidance) expect(prompt).toContain(rule);
      for (const rule of HOUSE_STYLE) expect(prompt).toContain(rule);
      for (const check of QUALITY_GATE) expect(prompt).toContain(check);
      expect(prompt).toContain(NEEDS_INPUT_MARKER);
    }
  });

  it("switches register without dropping the requirements", () => {
    const formal = documentSystemPrompt("jsa", "formal");
    const field = documentSystemPrompt("jsa", "field_level");
    expect(formal).toContain(toneDescriptors.formal.instruction);
    expect(field).toContain(toneDescriptors.field_level.instruction);
    // The section list is identical across registers — only the framing moves.
    for (const section of requireGenerator("jsa").sections) {
      expect(formal).toContain(section);
      expect(field).toContain(section);
    }
  });

  it("falls back to a generic instruction rather than throwing on an unknown key", () => {
    const prompt = documentSystemPrompt("not_a_generator");
    expect(prompt).toContain(HOUSE_STYLE[0]);
  });
});

describe("buildDocumentPrompt", () => {
  it("renders generator-specific answers and omits the ones left blank", () => {
    const prompt = buildDocumentPrompt({
      doc_type: "jsa",
      title: "Pipe Rack Demolition",
      details: { task_description: "Cut and lower pipe supports", location: "" },
      hazards: "Suspended loads",
    });
    expect(prompt).toContain("Pipe Rack Demolition");
    expect(prompt).toContain("Cut and lower pipe supports");
    expect(prompt).toContain("Suspended loads");
    expect(prompt).not.toContain("Location / work area:");
    expect(prompt).not.toContain("Jurisdiction:");
  });

  it("states the default jurisdiction assumption only when none was given", () => {
    const without = buildDocumentPrompt({ doc_type: "sop", title: "Crane Lift SOP" });
    const with_ = buildDocumentPrompt({ doc_type: "sop", title: "Crane Lift SOP", jurisdiction: "Indiana" });
    expect(without).toContain("29 CFR 1926");
    expect(with_).toContain("Jurisdiction: Indiana");
    expect(with_).not.toContain("No jurisdiction was specified");
  });

  it("places the client briefing before the request", () => {
    const prompt = buildDocumentPrompt(
      { doc_type: "sop", title: "Crane Lift SOP" },
      "CLIENT BRIEFING: they run a 24-hour operation.",
    );
    expect(prompt.indexOf("CLIENT BRIEFING")).toBeLessThan(prompt.indexOf("DOCUMENT REQUEST:"));
  });
});
