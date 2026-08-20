import { NextResponse } from "next/server";
import { getDocumentAccess } from "@/lib/documents/access";
import { generateSafetyDocument } from "@/lib/documents/builder";
import { documentToMarkdown } from "@/lib/documents/schema";
import type { DocType, DocumentBuilderInput } from "@/lib/documents/types";
import { coerceTone, getGenerator } from "@/lib/documents/generators";
import { validateAIOutput } from "@/lib/ai/gateway";
import { getClientContext } from "@/lib/ai/client-context";
import { applyClientDefaults, renderClientContextBlock } from "@/lib/ai/client-context-prompt";
import { recordAuditEvent } from "@/lib/audit/events";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { supabase, userId, isAdmin } = await getDocumentAccess();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  if (!userId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  if (!isAdmin) return NextResponse.json({ error: "Admin role required to generate documents." }, { status: 403 });

  let input: DocumentBuilderInput;
  try {
    input = (await req.json()) as DocumentBuilderInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const docType = input.doc_type as DocType;
  // The registry is the only source of valid document kinds. An unknown key is
  // rejected here rather than at the database CHECK constraint, so the caller
  // gets a useful message instead of a 500.
  const spec = getGenerator(docType);
  if (!spec) {
    return NextResponse.json({ error: `Unknown document type "${String(docType)}".` }, { status: 400 });
  }
  // An unrecognised tone falls back to the default rather than failing the run.
  input = { ...input, tone: coerceTone(input.tone) };
  if (!input.title || !input.title.trim()) {
    return NextResponse.json({ error: "A document title is required." }, { status: 400 });
  }

  // When the form names a client, the platform supplies what it already knows
  // about them: industry and jurisdiction fill any blanks the user left, and a
  // short briefing rides along with the prompt. Anything typed always wins, and
  // an unknown client simply yields no context.
  const clientContext = await getClientContext(input.client_id);
  input = applyClientDefaults(input, clientContext);

  const { data: generation, error: genError } = await supabase
    .from("document_builder_generations")
    .insert({
      user_id: userId,
      doc_type: docType,
      title: input.title.trim(),
      inputs: input,
      // Stamped so a generated document files back to the client it was drafted
      // for, instead of being findable only by whoever remembers running it.
      client_id: input.client_id ?? null,
      status: "running",
    })
    .select("id")
    .single();

  if (genError || !generation) {
    return NextResponse.json({ error: "Failed to start generation run." }, { status: 500 });
  }

  try {
    const result = await generateSafetyDocument(input, renderClientContextBlock(clientContext));
    const markdown = documentToMarkdown(result);

    // AI Gateway — official-workflow content must pass validateAIOutput().
    const gateway = validateAIOutput({ rawOutput: markdown });
    if (gateway.status === "blocked") {
      await supabase
        .from("document_builder_generations")
        .update({
          status: "error",
          gateway_status: gateway.status,
          error_message: gateway.blockedReason || "AI gateway blocked output",
          completed_at: new Date().toISOString(),
        })
        .eq("id", generation.id);
      return NextResponse.json({ error: "Document output was blocked by the AI safety gateway." }, { status: 422 });
    }

    // Human Authority Rule: every draft lands in the review queue. Whether it can
    // be published without an explicit approval is the generator's own call —
    // anything that authorises work, carries legal weight, disciplines a person,
    // or gets signed in the field sets humanReviewRequired and stays gated.
    const { data: draft, error: draftError } = await supabase
      .from("document_builder_drafts")
      .insert({
        generation_id: generation.id,
        doc_type: docType,
        title: result.title,
        sections: result.sections,
        body_markdown: markdown,
        tone: input.tone,
        review_status: "needs_review",
        human_review_required: spec.humanReviewRequired,
        confidence_level: result.confidence_level,
        created_by: userId,
      })
      .select("*")
      .single();

    if (draftError || !draft) {
      await supabase
        .from("document_builder_generations")
        .update({ status: "error", error_message: "Failed to save draft", completed_at: new Date().toISOString() })
        .eq("id", generation.id);
      return NextResponse.json({ error: "Generated document could not be saved." }, { status: 500 });
    }

    await supabase
      .from("document_builder_generations")
      .update({ status: "needs_review", gateway_status: gateway.status, completed_at: new Date().toISOString() })
      .eq("id", generation.id);

    await recordAuditEvent({
      event_type: "ai.document_generated",
      event_category: "ai",
      severity: gateway.status === "pass" ? "info" : "warn",
      actor_id: userId,
      resource_type: "document_builder_draft",
      resource_id: draft.id,
      summary: `Generated ${spec.label} draft "${result.title}" (gateway: ${gateway.status})`,
      after_state: {
        gatewayStatus: gateway.status,
        confidence: result.confidence_level,
        reviewNotes: result.review_notes,
        docType,
        tone: input.tone,
        humanReviewRequired: spec.humanReviewRequired,
      },
    });

    return NextResponse.json({ generationId: generation.id, draftId: draft.id, draft, gatewayStatus: gateway.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("document_builder_generations")
      .update({ status: "error", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", generation.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
