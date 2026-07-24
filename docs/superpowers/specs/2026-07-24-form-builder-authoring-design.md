# Form Builder Authoring UI + AMB Reachability — Design (Phase 2)

**Date:** 2026-07-24
**Status:** Approved design, pre-implementation
**Branch:** `feature/nostr-metadata-forms` (stacks on Phase 1a + Phase 1b Slice 1)
**Parent spec:** `docs/superpowers/specs/2026-07-18-nostr-metadata-forms-design.md` (Section 4 = Phase-2 builder) and `docs/superpowers/specs/2026-07-23-amb-basic-template-form-design.md` (the template form this phase makes buildable + reachable).

## Goal

Give `/forms/new` the ability to **author sections/steps, minimal branching, and field-output/vocab bindings**, and make the template-driven AMB resource form **reachable** — so a human can build a multi-step metadata form in the UI (not only via script-published JSON) and a normal user can reach the AMB form at `/create/resource/amb`.

This closes the "facilitate building forms" half of the original request and the concrete gap surfaced in testing: the builder cannot create sections/steps, and the slice-1 template form is unreachable in normal use.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Access scope | **Authoring UI for any logged-in user.** Community-admin h-tag + profile-list access control deferred to a later slice. |
| Branching depth | **Minimal:** option-level `nextSection` routing + single-condition `displayIf` (one question / operator / value). No AND/OR nesting in the UI. The engine already supports full trees. |
| amb-basic authoring | Stays **JSON-authored** (script-published); the builder is for new/custom templates. |
| Phase shape | One phase; the plan sequences it so **sections + output + palette** land before **branching UI** (a natural 4a/4b split point). |

## Context (verified in code)

The engine plumbing already exists — this phase is almost entirely UI:
- `FormBuilder.svelte` already carries `sections` through publish: `templateSections = $state(existing?.sections || [])` → passed to `buildFormTemplateTags(dTag, fields, { …, sections })` (lines 113, 300-306). It already carries `field.options.displayIf` through unchanged (lines 107, 294). Both are **passthrough-only — no authoring UI** (comments say so explicitly).
- `format.js` serializes/parses sections (`settings.sections`), option triples with `nextSection` config, and `displayIf` in field settings. `branching.js` evaluates `displayIf` + resolves `nextSection` routing. `FormRenderer` renders a sectioned template as a step wizard (Phase-1a). **None of this changes.**
- `FormBuilderFieldRow.svelte`: the field-output `<select>` (line 440) lives **inside** the `isChoiceType`/vocab-mode block, so output is only settable on choice/vocab fields today. `AMB_OUTPUTS` (line 45) lists name/description/about/learningResourceType/audience/educationalLevel/interactivityType/conditionsOfAccess/license/inLanguage/keywords — **missing** id/image/datePublished/dateCreated/isAccessibleForFree/creator/hasPart/isPartOf/refs.
- `FormBuilder` `FIELD_TYPES` (line 19): text/textarea/text-array/number/email/url/select/checkbox/radio/date — **missing** the slice-1 rich types creator/amb-relation/external-urls.
- Component registry (`form-field-types.js`) renders creator/amb-relation/external-urls/date; emitter registry (`amb-emitters.js`) serializes every `amb:<prop>` + these types. So anything the builder can produce already renders and serializes correctly.

## Architecture

### 1. Sections/steps authoring (`FormBuilder.svelte` + a new section-row component)

**Model:** interleaved section dividers in the field list (Formstr's model; matches our `FormSection = { id, title, description?, questionIds[], order }`). A field belongs to the section whose divider precedes it; section order = divider order; `questionIds` = the fields under each divider in order.

**State:** replace the passthrough `templateSections` with editable state. Keep the flat `fields` array as the source of field order; derive/maintain a parallel `sections` list of `{ id, title, description? }` plus a mapping of field→section. On publish, build `FormSection[]` by walking the field list and grouping under the active section divider. Fields before any divider go into an implicit first section (or the un-sectioned set — matching `orderedSections`' `__rest` handling).

**UI:** a "+ Add section" control; each section renders a header row (title input, optional description, reorder handles, delete — deleting a section reparents its fields to the previous section, never orphans). Existing field add/drag/reorder is preserved; dragging a field across a divider changes its section. A form with zero sections behaves exactly as today (flat, single-page) — sections are opt-in.

**New file:** `src/lib/components/forms/FormBuilderSectionRow.svelte` (section header: title/description/reorder/delete). `FormBuilder.svelte` orchestrates the interleaved render.

### 2. Branching authoring — minimal (`FormBuilderFieldRow.svelte` + option editor)

- **Option routing** (choice fields): in the manual-options editor, each option gains an optional "→ section" `<select>` listing the form's sections (empty = linear). Sets `option.nextSection`. Already serialized by `format.js` as the option triple's config.
- **Show-only-if** (all fields): a collapsible "Show only if…" control on each field row: question `<select>` (earlier fields only, by id+label), operator `<select>` (`equals` / `notEquals` / `contains`), and a value input — a `<select>` of the referenced question's options when it is a choice/vocab field, else a text box. Produces `field.options.displayIf = { rules: [{ questionId, operator, value }] }`. Empty/cleared → no `displayIf`. Single condition only; the value maps to option **ids** when the referenced field is choice-typed (so it matches the stored optionId, per `branching.js`).

Both editors read the form's current sections/fields from props threaded down from `FormBuilder`.

### 3. Field-output on every field + rich types in the palette (`FormBuilderFieldRow.svelte`, `FormBuilder.svelte`)

- **Move the output `<select>`** out of the choice/vocab-only block so it renders for every field type (a plain text field can map to `amb:name`). Keep the existing "auto (`amb:<id>`)" default option.
- **Extend `AMB_OUTPUTS`** with the missing slice-1 props: `amb:id`, `amb:image`, `amb:datePublished`, `amb:dateCreated`, `amb:isAccessibleForFree`, `amb:creator`, `amb:hasPart`, `amb:isPartOf`, `amb:refs` (each with a Paraglide label). Vocab/concept props stay as they are.
- **Add rich field types to `FIELD_TYPES`:** `creator`, `amb-relation`, `external-urls`. When one is added, its output is implied/locked appropriately: `creator → amb:creator`, `external-urls → amb:refs`, and `amb-relation` presents an `isPartOf`/`hasPart` output choice (the only meaningful decision for it). These types have no manual-options/vocab config (they render via their adapters), so `FormBuilderFieldRow` shows only label/required/output for them.

### 4. Reachability (B)

- **Add `sections` to `scripts/data/edufeed-forms.json`'s `amb-basic` entry** grouping its 16 fields into ordered steps: Basics (title, description, url, language, image, datePublished), Classification (about, learningResourceType, educationalLevel, keywords), Rights (license, isAccessibleForFree), Content & Creators (creators, externalUrls), Relations (hasPart, isPartOf). `publish-forms-build.mjs` already passes `sections` through (Phase-1b Task 6). The sectioned template then renders as a wizard automatically via `FormRenderer` inside `TemplateResourceForm`.
- **Activation** (`RESOURCE_FORM_TEMPLATE_NADDR_AMB`) is a deployment step — documented in the operator notes. For local/dev + E2E, add a documented dev-seed path (publish `amb-basic`, set the env) so `/create/resource/amb` routes to the template form and is testable end-to-end.

## Testing (TDD)

- **Component (jsdom), following existing `FormBuilder.test.js`/`FormBuilderFieldRow.test.js` patterns:**
  - Section authoring: add two sections, assign fields, reorder → publish → `parseFormTemplate` yields the expected `FormSection[]` with correct `questionIds`; deleting a section reparents its fields; a zero-section form still publishes flat.
  - Option routing: set an option's `nextSection` → the published template's option triple round-trips through `parseFormTemplate` with `nextSection` set; `branching.js#resolveNextSectionId` routes to it.
  - `displayIf`: build a show-if rule → `field.options.displayIf` round-trips; `branching.js#evaluateDisplayIf` returns the expected visibility; value maps to the referenced option's id for choice questions.
  - Output-on-any-type: a `text` field with `output: amb:name` publishes the `field-output` tag; the extended `AMB_OUTPUTS` options render.
  - Palette: adding `creator`/`amb-relation`/`external-urls` produces a field with the right type + implied output; relation's isPartOf/hasPart choice works.
- **Unit:** the field-list → `FormSection[]` grouping helper (pure), if extracted.
- **E2E (one flow):** in `/forms/new`, build a 2-section form with a routing option (section-A option → section-B) and a show-if field, publish, open its fill form, assert the wizard shows section A, choosing the routing option advances to section B, and the show-if field appears only when its condition holds. Plus: with `amb-basic` sectioned + a seeded `templateNaddr`, `/create/resource/amb` renders the multi-step AMB form. Add to `e2e/COVERAGE.md`.

## Out of scope (later)

- Community-admin scoping (h-tag templates + profile-list build/edit permission via `useProfileListAccess`).
- Full AND/OR rule-tree conditions UI (nested groups, all 9 operators, multi-condition per field).
- Slice-2 composite fields (image+license attestation, curriculum, EKW/Konfi facets, enrichment prefill, drafts, community share, wizard-fidelity edit).
- Library extraction (`[[form-builder-extraction-decision]]`).
- The publish-reliability trio (per-relay failure surfacing, optimistic navigate, E2E test-2 confirmation) — carried from slice 1.

## Risks

- **Sections state model** is the trickiest part: keeping the flat `fields` order and the section grouping in sync (drag across dividers, delete-reparent) without orphaning fields or duplicating ids. Mitigation: derive `FormSection[]` from field position at publish time rather than maintaining a second source of truth; a pure grouping helper with unit tests.
- **displayIf value ↔ optionId mapping**: when the referenced question is a choice field, the stored value must be the option **id** (not label), or `branching.js` won't match. The editor must bind the value `<select>` to option ids. Covered by a test.
- **Backward compat**: existing flat templates and the passthrough behavior must be unchanged when no sections/branching are authored. The zero-section and no-displayIf paths are explicit test cases.
