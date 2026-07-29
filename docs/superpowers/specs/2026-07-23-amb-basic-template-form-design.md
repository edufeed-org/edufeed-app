# AMB-Basic Template-Driven Form — Design (Phase 1b, Slice 1)

**Date:** 2026-07-23
**Status:** Approved design, pre-implementation
**Branch:** `feature/nostr-metadata-forms` (stacks on the Phase-1a NIP-101 alignment)
**Parent spec:** `docs/superpowers/specs/2026-07-18-nostr-metadata-forms-design.md` (Section 3 = Phase 1). This is the first executable slice of that phase.
**Authoritative external spec:** NIP-AMB (`naddr1qvzqqqrcvypzp0wzr7fmrcktw4sgemxh5zsq5auh08vnvlwf0x9anusn7pkft0zgqq9k2er4vejk2epdv9kky6ckr2a`) — the canonical kind-30142 tag grammar both emission paths must conform to.

## Goal

Deliver a **template-driven, NIP-AMB-compliant** learning-resource metadata form for the `amb` variant, reachable as a parallel route to the existing `ResourceFormWizard`, covering the field set whose emitted output is pure NIP-AMB and that fits the field-type registry cleanly. Bring the Phase-1a `form-to-amb` emission into strict NIP-AMB compliance in the process.

North star (from brainstorming): **a Nostr-spec-compliant, portable core that other apps can consume, with edufeed-specific features layered on top as optional extras.** This slice builds the portable core for `amb`; edufeed composite extras (image-license, curriculum, EKW/Konfi, enrichment, drafts, share, wizard-fidelity edit) are later slices on the same branch.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Canonical emission shape | **NIP-AMB is canonical.** Both paths conform to it; edufeed owns the converter and will adapt it (later slice). |
| Concept `a`-tags (shipped in 1a) | **Remove** — non-compliant with NIP-AMB (concepts identify by external URI via `:id`, not a 39738 coordinate; `a`-tags are for 30142 relations + the `form` back-ref only). This slice revises 1a, not just adds. |
| First-slice scope | `amb`-basic: portable fields + the compliance fixes. Wizard and converter untouched. |
| Field-render vs field-serialize | Split: a pure **emitter registry** (serialize) separate from the Svelte **component registry** (render). |
| Routing | Add `templateNaddr` to the variant registry; route to the template renderer when set, else the wizard. |
| Template authoring | Script-published 30168 event (same `publish-forms-build.mjs` + data-JSON pattern as membership forms). |
| Edit mode | Reuse the existing simple template edit path (corrected `parseAMBResourceForForm`); wizard-fidelity edit deferred. |

## Context (verified in code)

- **Two emission paths exist.** Wizard: `buildResourceData.js → educational-actions.svelte.js#createResource → convertFormDataToAMB (formDataToAmb.js) → ambToNostr` (external package `amb-nostr-converter`, edufeed-owned, sibling repo) + hand-appended tag helpers. Template: `src/lib/helpers/form-to-amb.js#buildAMBResourceTags`. This slice touches **only** the template path.
- **NIP-AMB concept grammar** (the compliance target): a concept is `["<prop>:id", <external-URI>]`, `["<prop>:prefLabel:<lang>", <label>]` (repeated per language), `["<prop>:type", "Concept"]`. **No `a`-tag.** `a`-tags are reserved for `isBasedOn`/`isPartOf`/`hasPart` relations to kind-30142 events and the `["a","30168:<pub>:<d>","<relay>","form"]` back-ref.
- **NIP-AMB `ext` grammar:** `["ext:<ns>:<facet>:<sub>", value]` where `<ns>` MUST be colon-free and, for form-emitted ext, is the form's **d-tag** (not `<pub>:<d>`, not containing the pubkey). Phase-1a `form-to-amb` currently emits `ext:<30168:pub:dtag>:<fieldId>` — non-compliant, fixed here.
- **`form-to-amb.js` is pure JS** (no Svelte imports) — the emitter registry must stay pure so the publish script and node tests can import it.
- **The component registry** (`src/lib/config/form-field-types.js`) maps `renderElement → Svelte component`; only `date → DateField` is wired today.
- **Variant registry** (`src/lib/config/resource-form-variants.js`) has no `templateNaddr`; `/create/resource/[variant]` hardcodes `<ResourceFormWizard>`.
- **`FormConceptPicker`** already emits `SelectedConcept[] = { id (external URI), nostrCoord, relay, labels{lang} }` and keys selection by external URI `id` — so dropping the concept `a`-tag does not break round-trip (nostrCoord becomes unused, not required).

## Field set (slice 1)

Each field maps to an AMB property via `field-output` and, for vocab fields, a `field-vocab` SKOS binding. "Component" is what edufeed registers; a foreign client without it degrades the field to a text input (NIP-101 philosophy) while the emitted tags stay identical in shape.

| Field | AMB property → tags | Component (edufeed) | Emitter |
| --- | --- | --- | --- |
| Title | `name` → `["name", v]` | text input | default scalar |
| Description | `description` → `["description", v]` + `content` | textarea | description emitter (also sets `content`) |
| Identifier | `id` → `["d", v]` | text input (or auto slug) | d-tag emitter |
| Language | `inLanguage` → `["inLanguage", v]` (repeatable) | select / text | default scalar (array) |
| Date created / published | `dateCreated`/`datePublished` → `[prop, ISO]` | `DateField` (registered) | default scalar |
| Image URL | `image` → `["image", url]` | text/url input | default scalar |
| License | `license` → `["license:id", uri]` | select | license emitter |
| Free access | `isAccessibleForFree` → `[prop, "true"/"false"]` | checkbox | boolean emitter |
| Subjects | `about` (concept) | `FormConceptPicker` | **concept emitter** |
| Resource type | `learningResourceType` (concept) | `FormConceptPicker` | concept emitter |
| Educational level | `educationalLevel` (concept) | `FormConceptPicker` | concept emitter |
| Audience | `audience` (concept) | `FormConceptPicker` | concept emitter |
| Keywords | `keywords` → `["t", kw]` (repeated) | text-array | keywords emitter |
| Creators | `creator` → `p`-tag or `creator:*` | `CreatorInput` (registered) | **creator emitter** |
| External URLs | (Nostr-native) → `["r", url]` (repeated) | `ExternalUrlInput` (registered) | r-tag emitter |
| Relations | `isPartOf`/`hasPart` → `a`-tag / flattened | `AMBResourceSearchInput` (registered, list-wrapped) | **relation emitter** |

**Deferred (later slices):** image+license attestation (1063 + `x`-tag), curriculum (`teaches`/`assesses`/`competencyRequired`), EKW/Konfi ext facets, `cover_color`, files (`LicensedFileInput`), `suggestedAge`, `trailer`/`encoding`/`caption` media, `publisher`/`funder`/`contributor`, `interactivityType`/`conditionsOfAccess`, `mainEntityOfPage`.

## Architecture

### 1. Emitter registry (pure, serialization)

`src/lib/helpers/forms/amb-emitters.js` — no Svelte imports.

```
/**
 * @typedef {Object} AmbEmitter
 * @property {(value:any, ctx:EmitCtx) => string[][]} emit   // value → NIP-AMB tags
 * @property {(event, field) => any} parse                    // 30142 event + field → form value (inverse)
 */
// EmitCtx: { field: FormField, prop: string, isExt: boolean, formDTag: string, defaultLang: string }
```

- A registry maps an emitter **key** (derived from `field.output`: `amb:<prop>` → concept/scalar/typed emitter by prop; `ext` → ext emitter; plus special field types `creator`/`relation`/`keywords`) to an `AmbEmitter`.
- `buildAMBResourceTags` (rewritten) iterates the template's fields, resolves each field's emitter, and concatenates `emit(value, ctx)`. Fields with no special emitter use the **default scalar emitter** (flatten to `["<prop>", value]`, arrays repeat).
- `parseAMBResourceForForm` (rewritten) iterates fields and calls each emitter's `parse`.

Emitters implemented this slice: `scalarEmitter` (default), `booleanEmitter` (`isAccessibleForFree`), `descriptionEmitter` (`description` + `content`), `dtagEmitter` (`id`→`d`), `conceptEmitter` (`about`/`learningResourceType`/`educationalLevel`/`audience` + any vocab field → `:id`/`:prefLabel:<lang>`/`:type`, **no a-tag**), `keywordsEmitter` (→ `t`), `licenseEmitter` (→ `license:id`), `creatorEmitter` (→ `p` or `creator:*` per NIP-AMB detection rules), `relationEmitter` (`isPartOf`/`hasPart` → `a` for 30142 coords, flattened for external), `rTagEmitter` (external URLs → `r`), `extEmitter` (`ext:<form-dtag>:<facet>:<sub>`).

The `["a","30168:<pub>:<d>","<relay>","form"]` back-ref is appended once by `buildAMBResourceTags` (spec-sanctioned).

### 2. Component registry (render) — extend existing

`src/lib/config/form-field-types.js` gains registrations mapping `renderElement` (or a field-type marker) → the edufeed component wrapped to the registry contract `{ field, value, error, readonly, onchange }`:
- `creator` → `CreatorFieldAdapter` wrapping `CreatorInput` (single bindable `Creator[]` ↔ `value`/`onchange`).
- `amb-relation` → `RelationFieldAdapter` wrapping `AMBResourceSearchInput` + a chip list it owns (the adapter holds the selected-relation array as the field `value`, since the picker is add-only).
- `external-urls` → `ExternalUrlFieldAdapter` wrapping `ExternalUrlInput`.
- Vocab-concept fields continue to render through `FieldsRenderer`'s existing `field.vocab` → `FormConceptPicker` branch (no new registration needed).
- Unknown/foreign types keep the Phase-1a text-input fallback.

Adapters follow the `DateField` precedent (writable-`$derived` local mirror + effect emitting `onchange`).

### 3. Routing + published template

- `ResourceFormVariant` typedef gains `templateNaddr?: string`; populated from config/env per variant (analogous to `SCHEME_NADDR_*`). `resource-form-variants.js`'s `amb` entry reads it.
- `/create/resource/[variant=resourceVariant]/+page.svelte`: if `getVariantById(variantId)?.templateNaddr` is set, load that kind-30168 event (addressLoader + `parseFormTemplate`) and render a template-driven resource component (the existing `/forms/[naddr]/create-resource` logic, extracted into a shared component so both routes share it); else render `<ResourceFormWizard>` unchanged.
- The amb-basic template: authored in `scripts/data/edufeed-forms.json` (new entry) with sections + `field`/`field-vocab`/`field-output` bindings, published via `scripts/publish-edufeed-forms.mjs` using the shared `buildFormTemplateTags`. Its naddr goes into deployment config to activate the route.

### 4. Edit / round-trip

Reuse the create-resource route's existing edit handling: `?edit=<30142-naddr>` → load resource → `parseAMBResourceForForm(resourceEvent, form)` (now emitter-driven) → `initialValues` for `FormRenderer` → re-publish reusing the resource's `d`-tag. No Bildungsbereich inference, creator-reattach, or drafts this slice.

## Compliance corrections to Phase-1a code

1. **`form-to-amb.js` concept emission:** drop `["a", nostrCoord, relay, role]` for concept fields; emit `:id` (external URI), `:prefLabel:<lang>` for **every** language in `labels`, `:type "Concept"`. (Phase-1a emitted the a-tag and, per the `emitForTarget` scalar path, single values fine — but concepts got the a-tag.)
2. **`form-to-amb.js` ext namespacing:** `ext:<form-dtag>:<facet>:<sub>` (colon-free ns = the form's d-tag), replacing `ext:<30168:pub:dtag>:<fieldId>`.
3. **`parseAMBResourceForForm`:** match concepts by external URI from `:id` (+ `:prefLabel` languages), not via `a`-tag role indexing.
4. **`docs/nips/nip-101-edu.md`:** correct the `field-output` section — concept fields produce `:id`/`:prefLabel:<lang>`/`:type` (no a-tag); ext uses `ext:<form-dtag>:<facet>`; cite NIP-AMB as the emission authority.
5. **`forms.interop.test.js` / `form-to-amb.test.js`:** update expectations that asserted concept a-tags.

## Testing (TDD)

- **Emitter units (node), golden fixtures from the NIP-AMB spec:** use the spec's Example 1 (concepts, keywords, license, `isAccessibleForFree`) and Example 2 (Nostr-native + external creators) tag arrays as golden expectations. Each emitter: `emit(value) === expected tags` and `parse(expected) === value` (round-trip). Explicit assertions: concept fields emit **no** `a`-tag; multi-language `prefLabel`; `ext` uses colon-free `<form-dtag>` namespace; `creator` with a `nostr:` id emits a `p`-tag (no `creator:*`), external creator emits `creator:*` (no `p`-tag); relation to a `30142:` coord emits an `a`-tag, external relation flattens.
- **`buildAMBResourceTags` integration (node):** a full amb-basic template + filled values → a tag set matching a hand-written NIP-AMB golden event; assert the `["a","30168:…","form"]` back-ref present.
- **Component (jsdom):** each adapter (`CreatorFieldAdapter`, `RelationFieldAdapter`, `ExternalUrlFieldAdapter`) renders, emits its value shape via `onchange`, honors `readonly`; unknown `renderElement` still falls back to text.
- **Publish-script (node):** `publish-forms-build.mjs` builds the amb-basic template; `parseFormTemplate` round-trips its sections/field-vocab/field-output.
- **E2E (one flow):** open the amb-basic template route, fill title/description/subject(vocab)/keywords/creator, publish, assert the resulting 30142 tags conform to NIP-AMB shape (name/description/content, `about:id`+`prefLabel`+`type` with no a-tag, `t` keywords, creator p-tag or `creator:*`, `form` back-ref). Add to `e2e/COVERAGE.md`.

## Out of scope (later slices, same branch)

- **Slice 2:** edufeed composite fields for `amb` — image+license (1063/`x`-tag), curriculum picker, files; enrichment prefill; drafts; community share; wizard-fidelity edit (Bildungsbereich inference, creator-reattach).
- **Slice 3:** EKW/Konfi variants (ext facets, sub-steps, bible refs) + converter (`amb-nostr-converter`) convergence to NIP-AMB (ext prefixing, multi-lang, `:type`), and eventual wizard retirement per variant.
- **Cross-cutting (revisit with the library-extraction decision, `[[form-builder-extraction-decision]]`):** whether the emitter registry + form engine become a shared spec-compliant package.

## Risks

- **Concept round-trip after dropping a-tags** relies on `FormConceptPicker` matching external URIs against loaded scheme concepts. If a resource references a concept whose scheme isn't loaded/configured, the label still restores from `:prefLabel` but the picker may show it as an unmatched chip. Acceptable; note in the adapter.
- **Emitter/component registry drift:** two registries keyed by field type must stay in sync. Mitigation: a single field-type manifest that both derive from, or a test asserting every registered component type has an emitter and vice-versa.
- **`templateNaddr` unset by default** means CI/dev see the wizard; the template route needs an explicit test-config naddr to exercise. The E2E seeds one.
