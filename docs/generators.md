# Generators

What the platform generates, why each one exists, and how to add another.

---

## 1.0  The finding

The platform already had a working document generator. `lib/documents/` runs the
full path — prompt assembly, strict JSON-schema output, AI gateway validation,
a human-review draft, PDF and DOCX rendering, hand-off to the Master Document
Library — and every part of it was generic except the catalog.

It knew two document kinds: `sop` and `policy`. Both were hardcoded into a
prompt function and pinned by a CHECK constraint. Adding a third meant editing
four files and a migration.

So this was never a question of building twenty generators. It was a question of
making the catalog **data**, then filling it.

---

## 2.0  What a generator is now

A generator is a registry entry in `lib/documents/generators/registry.ts`:

| Field | What it does |
|---|---|
| `key` | Stored as `doc_type`. Pinned by a DB CHECK constraint. Never reused. |
| `label`, `group`, `summary` | How it appears in the picker |
| `documentKind` | What the model is told it is writing |
| `sections` | The required section list, in order |
| `guidance` | Drafting rules specific to this document |
| `fields` | The inputs the form collects |
| `humanReviewRequired` | Whether publish is gated on an explicit human approval |
| `fieldUse` | Whether it is read standing on a jobsite |

The prompt is assembled in three layers, in this order:

1. **House style** — how every company document is written
2. **Tone** — which register this one is written in
3. **Generator spec** — what this document is, and its own rules

Nothing about a specific document kind is hardcoded anywhere else.

### 2.1  House style

`lib/documents/generators/house-style.ts` is the written form of the standard
every deliverable is measured against, and it applies to all 24 generators:

- Numbered sections, 1.0 / 1.1, never deeper than three levels
- Enforceable voice — `shall`, `must`, `is required`, `prior to starting work`,
  `no work shall proceed until`. Never `should consider` or `as needed` without
  a defined trigger.
- **Every requirement names who, what, and when or how it is verified.** A
  requirement missing one of the three is not finished.
- Delete any sentence that would be true on any jobsite anywhere
- Bracketed ALL-CAPS placeholders — `[PROJECT NAME]`, `[COMPETENT PERSON]`,
  `[MUSTER POINT]` — never an invented name, date, or phone number
- Citations as `29 CFR 1926.501(b)(1)`, or not at all. Never fabricated.
- Anything needing the author's own domain knowledge comes back as a
  `NEEDS YOUR INPUT:` line rather than a guess

The model self-checks against the quality gate before returning, and the same
gate is what the human reviewer is checking.

### 2.2  Tone

Six registers. The requirements never soften between them — only the framing
moves: **Formal**, **Audit-ready** (adds verification method and record location
to every requirement), **Executive** (leads with risk and exposure, one page),
**Field-level** (second person, "You must"), **Direct** (obligations only),
**Professional but simple**.

The tone is stored on the draft, so a document can be re-rendered in another
register later without re-running the analysis.

---

## 3.0  The catalog — 24 generators

### 3.1  Field Safety — used at the work face, often signed on site

| Generator | Review gated |
|---|---|
| Job Safety Analysis (JSA) | Yes |
| Daily Activity Plan (DAP) | Yes |
| Toolbox Talk | No |
| Permit-to-Work Package | Yes |
| Corrective Action Notice | Yes |
| Incident / Near-Miss Investigation | Yes |

The permit generator covers ten permit types — hot work, confined space,
energised electrical, LOTO, excavation, elevated work, line breaking, critical
lift, roof access, other. Every pre-start condition is emitted as a verifiable
checkbox line an issuer confirms by walking the area, not as an instruction.

### 3.2  Safety Program — the governing documents a site is held to

Site-Specific Safety Plan · Contractor Safety Expectations · Safety Coverage
Plan · Emergency Action Plan · SOP · Policy — all review-gated.

The coverage plan is built to be defended: every number ties to a stated driver
(headcount, shift pattern, high-hazard activity, area separation, client
requirement), and no gap may be presented without an interim control or an
explicit escalation.

### 3.3  Governance — verification and the things auditors ask for

Audit / Inspection Checklist · Field Safety Report · Certification & Training
Matrix.

The certification matrix links each high-hazard activity to the credential that
authorises it, with renewal lead times — the table that prevents unqualified
work rather than documenting it afterwards.

### 3.4  Commercial

Scope of Work · Pilot / Beta Program Agreement · Client Onboarding Packet.

**Proposals are deliberately not here.** `lib/proposals/` already owns that
pipeline end to end — type profiles, pricing, revisions, consistency checks,
DocuSign, share links. Duplicating it in the document builder would create two
sources of truth for the same client-facing document.

The pilot agreement describes access as a permission model — what each role can
see and do — rather than as a job title with implied access, and requires exit
terms covering the participant's data in every outcome.

### 3.5  People — everything here is review-gated except the ramp plan

Job Description · Offer Letter · 30/60/90 Plan · Performance Review Packet ·
Disciplinary Notice · Credential Expiration Notice.

The offer letter and disciplinary notice carry the strictest rules in the
registry: never infer, round, or improve a figure or a date; anything not
supplied comes back as `NEEDS YOUR INPUT`, not as a plausible default.

---

## 4.0  Human review

`humanReviewRequired` is true for anything that authorises work, carries legal
weight, disciplines a person, or gets signed in the field — 17 of the 24. Those
drafts cannot be published until a reviewer approves them; the gate is enforced
in `lib/documents/policy.ts` and asserted in `registry.test.ts`.

The remaining seven — toolbox talk, audit checklist, field safety report,
certification matrix, onboarding packet, 30/60/90 plan, credential expiration
notice — still land in the review queue. They just do not block an admin from
publishing.

---

## 5.0  The module scaffolder

`scripts/generate-module.mjs` is the other kind of generator: it scaffolds a
portal module that satisfies the MODULE SPECIFICATION CONTRACT.

```
node scripts/generate-module.mjs --spec module.json [--dry-run] [--force]
```

It emits the page, the loading skeleton, the error boundary, `access.ts`, a pure
`policy.ts` with a forward-only state machine, a policy test carrying the spec's
acceptance criteria, and a migration with the `updated_at` trigger, RLS
policies, self-attributing inserts, admin-only delete, and a rollback block.

The part that earns its keep: it **regenerates**
`portal_user_module_access_module_key_check` from the live
`portalModuleCatalog` rather than amending it. Three migrations in this repo
exist only to repair keys that reached the catalog but never reached that
constraint — which leaves a super admin unable to grant the module at all. That
class of drift is now self-healing: the next module anyone generates repairs it.

It does not touch `lib/user-management.ts` or `EmployeeSidebar.tsx`. It prints
the exact two lines and where they go. Those are deliberate edits, not
scaffolding.

---

## 6.0  Adding a generator

1. Add the entry to `lib/documents/generators/registry.ts`
2. Add the key to **both** `doc_type` CHECK constraints in a new migration that
   regenerates them in full, following
   `20260818210000_document_generator_registry.sql`
3. `npm test`

Step 2 is not optional and cannot be forgotten:
`lib/guardrails/document-generator-parity.test.ts` reads the newest migration
and fails the build when it disagrees with the registry. Without it the failure
is silent in dev and total in production — every insert for the new kind is
rejected, after the model has already been paid for.

Guidance goes in `guidance` or in a field's `placeholder`. It never goes in a
field value: a value baked into a form is autosaved and prints on the finished
document as though a person wrote it. That defect shipped once already — live
proposals addressed to "Client Representative" at "Street Address / City, State
ZIP", and an Executive Summary that opened with the asset's own writing
instructions. See `lib/guardrails/generator-asset-prefill.test.ts`.
