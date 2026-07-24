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

## Approach validation (KISS / DRY / applesauce)

- **applesauce (verified via MCP):** there is no form/template factory or form-builder primitive. Domain `*Factory.modify(event)` helpers exist (Wallet/Badge/AppData/Contacts) but none for forms, and `ActionRunner` targets incremental CRUD on existing events — the builder legitimately rebuilds the whole template from UI state, so the existing `EventFactory` + `buildFormTemplateTags` + `publishEvent` pattern is correct and simplest. No applesauce change.
- **KISS/DRY win — sections are divider entries in the existing field list, not a parallel subsystem.** A section is represented, *while editing*, as a `type: 'section'` item in the same `fields` list the builder already manages. This reuses the existing add/remove/drag/reorder machinery wholesale (no duplicate reorder logic, no separate stateful component, no field→section sync to keep consistent). Two pure functions convert between the editing list and the wire model. This removes the "keep flat fields and sections in sync" risk entirely — there is one list, one source of truth for order.

## Architecture

### 1. Sections/steps authoring — section-as-divider in the flat field list

**Editing model:** a section is a `type: 'section'` entry (carrying `{ id, title, description? }`) interleaved in the builder's existing `fields` list. The fields following a divider (until the next divider) belong to it; fields before the first divider are un-sectioned. All existing controls — add, remove, drag-reorder, arrow-move — work on the unified list unchanged; a divider is just another list item, so "moving a field into a section" or "reordering sections" needs **no new logic**. Deleting a divider merges its fields into the preceding section automatically (there is nothing to re-parent — grouping is re-derived from the remaining dividers).

**Two pure conversion functions** (new `src/lib/helpers/forms/builder-sections.js`, unit-tested first):
- `extractSections(items) → { fields, sections }` — walk the editing list; `section` items become `FormSection[]` (`{ id, title, description?, questionIds: [ids of following non-section fields], order }`); non-section items become the real `fields`. Called in `publish()` before `buildFormTemplateTags(dTag, fields, { …, sections })`.
- `interleaveSections(fields, sections) → items` — inverse, for edit/fork load: place a `section` divider before each section's `questionIds`, preserving order, appending any un-referenced fields at the front (mirrors `orderedSections`' `__rest`). Replaces the current passthrough `templateSections` seeding.

Round-trip (`extract ∘ interleave === identity` on well-formed input) is the core unit test. The `section` divider **never** becomes a wire `field` tag — `extractSections` removes it — so there is no NIP-101/`inputType:"label"` collision; it is purely a builder-editing representation of `settings.sections`.

**UI:** a "+ Add section" control appends a `section` divider; the divider renders as a lightweight header (title input, optional description, the same reorder/delete affordances as a field row — reused, not reimplemented). A form with zero `section` dividers publishes exactly as today (flat, no `sections`) — sections are opt-in and backward compatible.

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

- **Unit (node) — the pure conversion helpers, written first:** `extractSections`/`interleaveSections` in `builder-sections.js` — round-trip identity on well-formed input; edge cases (leading un-sectioned fields, empty section, divider with no following fields, zero dividers → empty `sections`). This is the load-bearing correctness test; the UI sits on top.
- **Component (jsdom), following existing `FormBuilder.test.js`/`FormBuilderFieldRow.test.js` patterns:**
  - Section authoring: add two section dividers, place fields under them, reorder → publish → `parseFormTemplate` yields the expected `FormSection[]` with correct `questionIds`; deleting a divider merges its fields into the previous section; a zero-section form still publishes flat (no `sections` tag).
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

- **`extractSections`/`interleaveSections` round-trip correctness** is the one thing that must be exact (a mis-grouping silently drops fields from a section on re-save). Mitigation: both are pure functions, unit-tested first with a round-trip property and edge cases (un-sectioned leading fields, empty sections, a divider with no following fields). This is a far smaller surface than a synced parallel-state model.
- **displayIf value ↔ optionId mapping**: when the referenced question is a choice field, the stored value must be the option **id** (not label), or `branching.js` won't match. The editor binds the value `<select>` to option ids. Covered by a test.
- **Backward compat**: existing flat templates and the passthrough behavior must be unchanged when no sections/branching are authored. The zero-section and no-displayIf paths are explicit test cases.
