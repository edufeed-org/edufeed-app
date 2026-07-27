# Nostr Metadata Forms — Design

**Date:** 2026-07-18
**Status:** Approved design, pre-implementation
**Research basis:** NIP-101 draft ([nostr-protocol/nips PR #1190](https://github.com/nostr-protocol/nips/pull/1190), [spec text](https://github.com/abh3po/nips/blob/nostr-form/101.md)), Formstr implementation ([formstr-hq/nostr-forms](https://github.com/formstr-hq/nostr-forms): sections PR #334 merged, conditional visibility PR #252, section routing issue #478), live-relay sampling of kind 30168/1069 events, and a full map of the app's two existing form systems.

## Goal

Make edufeed's metadata forms "purely Nostr": form definitions live as kind 30168 events (NIP-101-aligned), filling a metadata form publishes a kind 30142 AMB resource, and — in a second phase — community admins can build and adapt form templates in-app.

**End state (phased):**

- **Phase 1 — Transform:** the AMB resource form becomes template-driven via a parallel route; the hardcoded `ResourceFormWizard` (~3,100 lines) stays untouched and is retired per-variant only once a deployment can run fully on templates.
- **Phase 2 — Build:** the existing `FormBuilder` grows into a metadata form builder for community admins (Communikey-integrated).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| End goal | Both phases, phased: transform first, builder second |
| NIP-101 interop | Align base wire format with NIP-101; document our additions as an extension spec |
| Phase-1 strategy | Parallel route (grow `/forms/[naddr]/create-resource`), converge later; no in-place wizard refactor |
| Extension spec form | NIP-style markdown doc in this repo (like the Communikey spec); no upstream coordination yet |
| Phase-2 builders | Community admins (profile-list access control, h-tag community binding) |
| Form output | 30142 only — metadata forms are event composers, no 1069 receipts. Membership forms keep their existing 1069 flow |
| Field parity target | Full AMB-variant parity, including rich fields (image+license, creators, curriculum, relations) via a field-type registry |
| Branching | Adopt Formstr's three mechanisms (sections, `displayIf`, option-level section routing) inside settings JSON |
| Engine approach | Evolve System A (existing 30168/1069 engine) in place; `@formstr/sdk` used only as a test-time compatibility oracle, never a runtime dependency |

## Context: what already exists

Two form systems plus a bridge (verified in code):

- **System A — Nostr forms engine:** `src/lib/helpers/forms.js`, `src/lib/components/forms/` (`FormRenderer`, `FieldsRenderer`, `FormBuilder`, `FormConceptPicker`, `FormResponses`), routes under `src/routes/forms/**`. Kind 30168 templates with per-field tags, kind 1069 responses (NIP-44-encrypted to form author by default, `["public"]` opt-out). Already has SKOS vocab bindings (`field-vocab` → kind 39737 schemes), output mapping (`field-output` → AMB properties), fork provenance, and a working drag-and-drop builder. Used in production for membership applications.
- **System B — `ResourceFormWizard.svelte`:** hardcoded 8-step wizard producing 30142 via the AMB-JSON-LD pipeline (`buildResourceData → convertFormDataToAMB → ambToNostr`). Config-driven only at the edges; notably the Konfi sub-steps already render through System A's `FieldsRenderer` (`subStepToFormFields`) — proof the convergence works.
- **The bridge:** `/forms/[naddr=naddr]/create-resource` + `src/lib/helpers/form-to-amb.js` renders a 30168 template and publishes a 30142. Its flat SKOS tag emission diverges from the wizard's AMB pipeline (resolved below).

**Interop problem:** our 30168 dialect is wire-incompatible with the NIP-101 draft despite sharing kind numbers — field-tag position 4 is `defaultValue` for us, options JSON for them; we store option values, they store optionIds. Live relays also carry a third dialect ("lotus" client, JSON-in-content). Installed base of our dialect is tiny (centrally-published membership forms), so aligning now is cheap.

## Section 1: Wire format & extension spec

### Base layer — NIP-101 as written

Field tags adopt NIP-101 positions exactly:

```
["field", fieldId, inputType, label, optionsJSON, settingsJSON]
```

- `inputType` ∈ `text` | `option` | `label` (NIP-101 primitives). All rich types (`textarea`, `number`, `date`, `select`, `checkbox`, `radio`, `email`, `url`, `text-array`, and new ones like `image-licensed`, `creator`, `curriculum`, `amb-relation`) move to `settingsJSON.renderElement` — Formstr's own convention, so foreign clients degrade to text inputs instead of misparsing.
- Options are `[optionId, label, config]` triples in `optionsJSON`. Answers store **optionIds**, semicolon-delimited for multi-select. `defaultValue` moves into field settings.
- Form level: `d`, `name`, `relay` tags per NIP-101, plus one `["settings", JSON]` tag that absorbs our discrete `description` / `public` / `confirmation_message` / `auto_response` tags. Key names align with Formstr's `IFormSettings` where equivalents exist (`description`, `publicForm`, `sections`).
- Responses (kind 1069, membership flow only): NIP-101 encoding — `["a", "30168:<pubkey>:<d>"]` + `["response", fieldId, value, metadataJSON]`; encrypted variant puts the response-tag array in `content`, NIP-44 responder→author. Option answers use optionIds.

### Branching (inside settings JSON, Formstr-compatible)

1. **Sections** (= wizard steps): `settings.sections: [{ id, title, description, questionIds: [], order }]` — matches Formstr's merged implementation.
2. **Conditional visibility:** field `settings.displayIf = { rules: ConditionGroup[] }` where `ConditionGroup = { questionId, operator, value, nextLogic: "AND"|"OR", rules? }`, operators `equals | notEquals | contains | startsWith | endsWith | greaterThan | lessThan | greaterThanEqual | lessThanEqual`. Evaluated client-side against current answers.
3. **Section routing** (= the Bildungsbereich path dependency): option config may carry `nextSection: "<sectionId>"`; no rule → linear order. Mirrors Formstr issue #478's proposal.

### Extension layer — "NIP-101-EDU" doc

A standalone NIP-style markdown in this repo at `docs/nips/nip-101-edu.md` (force-added, since `docs/` is gitignored — same convention as the specs directory) normatively documenting our additive tags:

```
["field-vocab", fieldId, "a", "39737:<pubkey>:<d>", relayUrl]    // bind field options to a SKOS ConceptScheme
["field-output", fieldId, "amb:<property>" | "ext"]              // map answer → output-event property
["output", "30142"]                                              // form composes an event kind instead of collecting 1069s
["a", "30168:<pubkey>:<d>", relayUrl, "forkOf"]                  // fork provenance
```

The doc also specifies the sections / `displayIf` / `nextSection` settings schemas (upstream never wrote them down), and the back-reference convention on produced events: the 30142 carries `["a", "30168:…", relay, "form"]` plus the existing NIP-32 labels (`["L","metadata-form"]`, `["l", variantId, "metadata-form"]`).

**Explicitly out of scope:** NIP-101's private-form apparatus (view/signing keys, gift-wrapped key distribution, alias pubkeys). Our templates are plaintext-public; the doc notes this as a deliberate omission.

## Section 2: Engine architecture

`src/lib/helpers/forms.js` splits into a module folder:

```
src/lib/helpers/forms/
  format.js      # build/parse NIP-101+ext tags (pure functions)
  legacy.js      # read-only shim for old-dialect templates; deleted after re-publish
  validate.js    # per-field validation (moves from forms.js)
  branching.js   # evaluateDisplayIf(rules, values), resolveNextSection(field, answer, sections) (pure)
```

**Field-type registry** — `src/lib/config/form-field-types.js`: maps `renderElement` → lazily-imported Svelte component + capability flags (needsVocab, extraBindings such as `licenseEvent`/`imageWasUploaded`). `FieldsRenderer` consults the registry; unregistered types fall back to a text input. Registered rich components (unchanged internally): `LicensedImageInput`, `CreatorInput`, `CurriculumPicker`, `AMBResourceSearchInput`, `EuropeanDateInput`, `SKOSDropdown`/`FormConceptPicker`.

**One AMB emission path.** The bridge's flat `prop:id` / `prop:prefLabel:<lang>` tag emission is retired. `field-output` mappings assemble the same `formData` shape the wizard produces, which then flows through the existing `buildResourceData → convertFormDataToAMB → ambToNostr` pipeline. Template-driven and wizard-driven 30142 events are indistinguishable; downstream search/display code never sees two shapes.

**Renderer:** `FormRenderer` gains section navigation — progress indicator, back/next honoring `nextSection` routing, `displayIf` evaluation on every answer change. This reproduces the wizard's step UX.

## Section 3: Phase 1 — parallel resource-form route

- **Template selection:** `src/lib/config/resource-form-variants.js` gains an optional `templateNaddr` per variant (env-configurable, analogous to `SCHEME_NADDR_*`). Variant with a template naddr → "Share Learning Resource" routes to the template-driven form; without → existing wizard. Convergence is per-deployment, per-variant, reversible.
- **The AMB template** is a published 30168 event: sections mirror the wizard's steps, Bildungsbereich is the routing option field, vocab bindings point at the existing `schemeNaddrs` schemes. Authored via script first (pattern: `scripts/publish-membership-form.js`); builder-editable in Phase 2. The existing `bildungsbereich.js` config object converts to template data near-mechanically.
- **Enrichment prefill** stays app chrome: field `settings.prefillSource` names an enrichment-payload key; the route maps `/api/enrich` output onto field values before render. The event never references our server.
- **Drafts:** keep the localStorage draft store, keyed by template coordinate instead of variantId. NIP-37 (kind 31234) is the noted future purely-nostr option, not built now.
- **Publish** via the existing `createResource` action (`educational-actions.svelte.js`) — outbox model, relay categories, NIP-32 labels unchanged.

## Section 4: Phase 2 — builder for community admins (architecture level)

`FormBuilder` gains: section management (create/reorder/assign fields), `displayIf` + `nextSection` editors (single-level AND/OR rule UI, like Formstr's), an AMB-property picker for `field-output` (fed from the variant registry, replacing free-text), and the rich-field palette from the registry. Communikey integration: templates may carry `["h", communityPubkey]`; build permission follows the community's profile-list access control (`useProfileListAccess`); community pages list their form templates. Phase 2 gets its own spec/plan once Phase 1 lands — this section is scope-setting only.

## Section 5: Migration & compatibility

- **Membership forms:** re-publish both central templates in NIP-101 encoding (script rerun). `legacy.js` reads the old dialect until then, then is deleted. Response decryption logic unchanged apart from optionId answers.
- **Foreign 30168 events** (Formstr, "lotus"): `/forms` listing shows only what parses as NIP-101(+ext); opening a genuine Formstr form by naddr renders it — that is the interop payoff. The lotus JSON-in-content dialect simply fails to parse and is ignored.
- **Compatibility oracle:** real Formstr events (captured from relays during research) become unit-test fixtures. Optionally `@formstr/sdk` as a dev-dependency in tests only — assert their normalizer accepts our templates. Never a runtime dependency (it uses nostr-tools for relay work, which this codebase forbids).

## Section 6: Testing (TDD throughout)

- **Unit (node):** `format.js` build/parse round-trips; legacy shim; `branching.js` evaluator — rule trees, operators, section routing, with the Bildungsbereich path as a named fixture; `field-output` → `formData` assembly; Formstr fixture parsing.
- **Equivalence test:** wizard pipeline vs template pipeline produce identical 30142 tags/content for the same logical input — the guarantee behind "one emission path".
- **Component (jsdom):** registry fallback for unknown `renderElement`; section navigation; `displayIf` reactivity; vocab-bound field rendering.
- **E2E (one flow):** open AMB template → branch through Bildungsbereich → fill → publish → verify 30142 tags. Added to `e2e/COVERAGE.md`.

## Risks & open items

- **Upstream drift:** NIP-101 is a draft; positions could still change. Mitigation: `format.js` is the single encode/decode point, and the extension doc records exactly which revision we align to.
- **Sections/`displayIf` schemas are Formstr-internal**, not spec'd upstream — our extension doc becomes their first written spec; if Formstr changes shape, we adapt `format.js`/`branching.js` (settings JSON is versionable).
- **Two signer NIP-44 API surfaces** (`signer.nip44.encrypt` vs `signer.nip44Encrypt`) exist in the response writers; unify while touching response encoding.
- **Wizard retirement criteria** (per variant): template route reaches field parity, equivalence test green, deployment opts in via `templateNaddr` — only then may wizard code for that variant be removed, in a later cleanup.
