import { describe, expect, it } from "vitest";
import { applyClientDefaults, renderClientContextBlock } from "./client-context-prompt";
import type { ClientContext } from "./client-context";

function context(overrides: Partial<ClientContext> = {}): ClientContext {
  return {
    clientId: "11111111-2222-3333-4444-555555555555",
    name: "Acme Construction",
    industry: "General Contractor",
    state: "Texas",
    lifecycleStage: "Active Company",
    proposals: [],
    filedDocumentTitles: [],
    legalTopics: [],
    ...overrides,
  };
}

describe("renderClientContextBlock", () => {
  it("returns nothing when there is no client", () => {
    expect(renderClientContextBlock(null)).toBe("");
    expect(renderClientContextBlock(undefined)).toBe("");
  });

  it("states the facts a blank form used to require retyping", () => {
    const block = renderClientContextBlock(context());
    expect(block).toContain("Acme Construction");
    expect(block).toContain("General Contractor");
    expect(block).toContain("Texas");
    expect(block).toContain("prefer these facts");
  });

  it("names only work actually sold, not everything quoted", () => {
    const block = renderClientContextBlock(
      context({
        proposals: [
          { title: "Safety Program Buildout", status: "accepted", value: 48000, acceptedAt: "2026-07-01" },
          { title: "Speculative Retainer", status: "draft", value: 10000, acceptedAt: null },
        ],
      }),
    );

    expect(block).toContain("Safety Program Buildout");
    // A draft is not work they bought; telling the model otherwise invents history.
    expect(block).not.toContain("Speculative Retainer");
  });

  it("lists filed documents and open legal topics", () => {
    const block = renderClientContextBlock(
      context({ filedDocumentTitles: ["Master Services Agreement"], legalTopics: ["OSHA 1926 subpart M review"] }),
    );
    expect(block).toContain("Master Services Agreement");
    expect(block).toContain("OSHA 1926 subpart M review");
  });

  it("omits empty sections rather than asserting a negative", () => {
    const block = renderClientContextBlock(context({ industry: null, state: null, lifecycleStage: null }));
    expect(block).not.toContain("Industry");
    expect(block).not.toContain("none");
    expect(block).not.toContain("null");
  });

  it("returns nothing when the record is empty enough to say nothing useful", () => {
    const block = renderClientContextBlock(
      context({ name: "", industry: null, state: null, lifecycleStage: null }),
    );
    expect(block).toBe("");
  });
});

describe("applyClientDefaults", () => {
  it("fills blanks from the client record", () => {
    const filled = applyClientDefaults({ industry: "", jurisdiction: undefined }, context());
    expect(filled.industry).toBe("General Contractor");
    expect(filled.jurisdiction).toBe("Texas");
  });

  it("never overwrites what someone typed", () => {
    // The person may be drafting for a site in another state; the value in front
    // of them wins.
    const filled = applyClientDefaults({ industry: "Marine", jurisdiction: "Louisiana" }, context());
    expect(filled.industry).toBe("Marine");
    expect(filled.jurisdiction).toBe("Louisiana");
  });

  it("treats whitespace as blank", () => {
    const filled = applyClientDefaults({ industry: "   " }, context());
    expect(filled.industry).toBe("General Contractor");
  });

  it("leaves the input untouched when there is no context", () => {
    const input = { industry: "", jurisdiction: "" };
    expect(applyClientDefaults(input, null)).toEqual(input);
  });

  it("does not invent a value the client record does not have", () => {
    const filled = applyClientDefaults({ industry: "" }, context({ industry: null }));
    expect(filled.industry).toBe("");
  });

  it("preserves unrelated fields", () => {
    const filled = applyClientDefaults({ industry: "", title: "Fall Protection SOP" }, context());
    expect(filled.title).toBe("Fall Protection SOP");
  });
});
