-- Document Builder: open the generator catalog
--
-- The AI Document Builder shipped with exactly two document kinds, pinned by a
-- CHECK constraint on doc_type in both of its tables. Everything else about the
-- builder — prompt assembly, the review queue, the publish gate, PDF/DOCX
-- rendering, the Master Document Library hand-off — is already generic.
--
-- The catalog now lives in code at lib/documents/generators/registry.ts. This
-- migration widens both constraints to match it and adds the tone the draft was
-- written in, so a document can be re-rendered in another register later
-- without re-running the analysis.
--
-- The constraint is REGENERATED from the full registry rather than amended, so
-- the list in this file is always the complete set — the same idiom used for
-- portal_user_module_access in 20260731120000_mobile_app_module_access.sql.
-- lib/guardrails/document-generator-parity.test.ts reads this file and fails the
-- build if it drifts from the registry.
--
-- No RLS policy, no role, and no existing row is touched. 'sop' and 'policy'
-- keep their keys, so every draft already in the system is unaffected.
--
-- ROLLBACK
--   alter table public.document_builder_drafts drop column if exists tone;
--   alter table public.document_builder_generations
--     drop constraint if exists document_builder_generations_doc_type_check;
--   alter table public.document_builder_generations
--     add constraint document_builder_generations_doc_type_check
--     check (doc_type in ('sop', 'policy'));
--   alter table public.document_builder_drafts
--     drop constraint if exists document_builder_drafts_doc_type_check;
--   alter table public.document_builder_drafts
--     add constraint document_builder_drafts_doc_type_check
--     check (doc_type in ('sop', 'policy'));
--   Safe at any time PROVIDED no draft or generation row uses a widened key —
--   check first with:
--     select distinct doc_type from public.document_builder_drafts
--     union select distinct doc_type from public.document_builder_generations;

-- ============================================================================
-- 1. document_builder_generations.doc_type
-- ============================================================================
alter table public.document_builder_generations
  drop constraint if exists document_builder_generations_doc_type_check;

alter table public.document_builder_generations
  add constraint document_builder_generations_doc_type_check
  check (
    doc_type in (
      -- Field Safety
      'jsa',
      'daily_activity_plan',
      'toolbox_talk',
      'permit_package',
      'corrective_action_notice',
      'incident_investigation',
      -- Safety Program
      'site_safety_plan',
      'contractor_expectations',
      'safety_coverage_plan',
      'emergency_action_plan',
      'sop',
      'policy',
      -- Governance
      'audit_checklist',
      'field_safety_report',
      'certification_matrix',
      -- Commercial
      'scope_of_work',
      'pilot_agreement',
      'client_onboarding_packet',
      -- People
      'job_description',
      'offer_letter',
      'onboarding_plan',
      'performance_review',
      'disciplinary_notice',
      'credential_expiration_notice'
    )
  );

-- ============================================================================
-- 2. document_builder_drafts.doc_type
-- ============================================================================
alter table public.document_builder_drafts
  drop constraint if exists document_builder_drafts_doc_type_check;

alter table public.document_builder_drafts
  add constraint document_builder_drafts_doc_type_check
  check (
    doc_type in (
      -- Field Safety
      'jsa',
      'daily_activity_plan',
      'toolbox_talk',
      'permit_package',
      'corrective_action_notice',
      'incident_investigation',
      -- Safety Program
      'site_safety_plan',
      'contractor_expectations',
      'safety_coverage_plan',
      'emergency_action_plan',
      'sop',
      'policy',
      -- Governance
      'audit_checklist',
      'field_safety_report',
      'certification_matrix',
      -- Commercial
      'scope_of_work',
      'pilot_agreement',
      'client_onboarding_packet',
      -- People
      'job_description',
      'offer_letter',
      'onboarding_plan',
      'performance_review',
      'disciplinary_notice',
      'credential_expiration_notice'
    )
  );

-- ============================================================================
-- 3. tone
-- ============================================================================
-- Nullable with no default: a draft written before tone existed genuinely has
-- no recorded register, and claiming it was 'formal' would be a guess. The app
-- treats null as the default when re-rendering.
alter table public.document_builder_drafts
  add column if not exists tone text;

alter table public.document_builder_drafts
  drop constraint if exists document_builder_drafts_tone_check;

alter table public.document_builder_drafts
  add constraint document_builder_drafts_tone_check
  check (
    tone is null
    or tone in ('formal', 'audit_ready', 'executive', 'field_level', 'direct', 'plain')
  );

comment on column public.document_builder_drafts.tone is
  'Register the draft was written in; keys are defined in lib/documents/generators/house-style.ts. Null for drafts created before tones existed.';
