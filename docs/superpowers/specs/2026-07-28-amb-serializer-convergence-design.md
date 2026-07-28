# AMB-Serializer Convergence — Design

**Date:** 2026-07-28
**Status:** Approved design, pre-implementation
**Branch:** `feature/nostr-metadata-forms` (stacks on the completed forms work; convergence is a follow-on)
**Shared lib:** `amb-nostr-converter` (sibling repo, npm `amb-nostr-converter@0.0.0-2f68a71`, already a dependency, NIP-AMB-aligned). Memory: `amb-serializer-convergence-plan`, `amb-ext-dual-implementation`.

## Goal

One canonical AMB↔Nostr serializer. Route the **template-driven** form's kind-30142 output through the shared `amb-nostr-converter` (`ambToNostr` for write, `nostrToAmb` for read), retiring the in-app `amb-emitters.js`/`form-to-amb.js` emit path. Additionally, unify the **wizard's** hand-appended EKW/Konfi facets through the converter's `ext` capability (fixing a live-preview gap and upgrading single-language → multi-language labels).

## Corrected premise (re-verified 2026-07-28)

The prior worry — "migrate the wizard's EKW/Konfi from legacy unprefixed `ekw:` to prefixed `ext:ekw:`" — is **already done**. `ekwNamespace.js` defines `EKW_TAG_PREFIX = 'ext:ekw:'`; `formDataToEkwTags.js`/`konfiTags.js` already emit prefixed `ext:ekw:<facet>:…` / `ext:ekw:konfi:<slug>:…`. The unprefixed `ekw:` is only a legacy *read* fallback. So there is **no migration**; the only divergence from the converter is that EKW/Konfi hardcode `:prefLabel:de` (single language) while `ambToNostr` emits all languages. This de-risks the whole project.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Scope | Both: (A) template convergence + (B) wizard EKW/Konfi unification. |
| Wizard read-side (EKW/Konfi + `getAMB*`) → `nostrToAmb`? | **Deferred.** Keep the existing wizard readers; converge only the template read + the wizard write. |
| Template read | Converge onto `nostrToAmb` (both directions for the template). |
| EKW/Konfi output change | Accept `:de`-only → all-languages (existing readers + `nostrToAmb` handle it; existing single-lang resources still read). |

## Context (verified in code)

- **Wizard write** (`educational-actions.svelte.js#createResource/updateResource`): `convertFormDataToAMB(formData)` → `ambToNostr(ambData, {pubkey, timestamp, relatedEvents})`, then hand-appends: `appendCreatorPTags` (`p`), `appendExternalUrlTags` (`r`), `appendVariantLabelTags` (`L`/`l`), `appendCoverColorTag` (`cover_color`), `formDataToEkwTags` (`ext:ekw:*`), `konfiTags` (`ext:ekw:konfi:*`), image `['x',hash]`, and (update) preserved `['h',…]`. **`convertFormDataToAMB` never sets `amb.ext`** — EKW/Konfi bypass the converter entirely though it supports `ext`.
- **`ambToNostr` `ext` support** (`ambToNostr.ts:434-455`, live in the installed dist): `amb.ext[ns][facet]` where each item is a `Concept` (`{id, type, prefLabel{lang}}`) → `ext:<ns>:<facet>:id`/`:prefLabel:<lang>`/`:type`, or a string → bare `ext:<ns>:<facet>`. **The converter does not (yet) validate the key — it emits whatever object keys it is handed** (verified: no `includes(':')` guard). NIP-BOSS is adding a write-side guard that rejects colon-bearing `ns`/`facet`; we must emit conformant keys before it lands (see the amended-grammar note below).

> **NORMATIVE `ext:` GRAMMAR (NIP-AMB amended 2026-07-28, nips@f822603 branch edufeed-amb) — supersedes any illegal shape below.**
> `ext-key = "ext" ":" ns ":" facet [ ":" sub ]` where `sub = "id" / "type" / "name" / "prefLabel" ":" lang`. **`ns` and `facet` MUST NOT contain `":"`** (`.` is permitted; reverse-DNS RECOMMENDED). Parse left-anchored, fixed arity; non-matching keys MUST be ignored, never guessed.
> - **Slice A is already conformant:** template `ext` emits `ext:<form-d-tag>:<field-id>` — colon-free `ns` + `facet`. No change.
> - **Konfi (Slice B) is the one violation:** `konfiTags.js` `KONFI_PREFIX='ext:ekw:konfi:'` emits `ext:ekw:konfi:<slug>:id` — a 5-segment key whose two internal segmentations (`ns=ekw,facet=konfi` vs `ns=ekw:konfi,facet=<slug>`) are ambiguous; the relay (`SplitN(":",4)`) and the app (`parseExtensionTags.js`, right-anchored) parse it differently, fusing/shredding facets on the relay side. This corrupts live data for any relay consumer (the WordPress plugin found it).
> - **Fix:** lift `konfi` out of the facet position into the namespace: `amb.ext['ekw.konfi'] = { zielgruppen:[…], themen:[…], … }` → `ext:ekw.konfi:<slug>:id` (`ns=ekw.konfi` colon-free, `.` legal; `facet=<slug>`; `sub=id`). Non-konfi `ekw` facets (`ext:ekw:gradeLevel:id`) are **already legal** — leave them under `ekw`.
> - **Namespace string is NIP-BOSS's call:** `ekw.konfi` (smallest legal diff, narrowest re-publish) vs full reverse-DNS `org.edufeed.ekw.konfi`. Implement it as ONE named constant so the choice is a one-line swap; default `ekw.konfi` pending confirmation.
> - **Not ours (do not duplicate):** relay `nostr_amb.go` mis-bucketing + 3-part scalar drop; `amb-nostr-converter` parse/write guards + test inversion; re-publishing existing EKW/Konfi events into the new namespace (Bumble). There is deliberately **no back-compat read shim** — conformant consumers ignore the old `ext:ekw:konfi:*` outright, so between the relay fix and Bumble's re-publish those facets are invisible, not merely wrong.
- **Template write** (`form-to-amb.js#buildAMBResourceTags` + `amb-emitters.js`): fully self-contained, never calls the converter. Emits per `field.output` (`amb:<prop>` / `ext`) + `selectedConcepts` + composite emitters (creator→`p`/`creator:*`, amb-relation→`a`, external-urls→`r`); appends the `["a","30168:…","form"]` back-ref. Its `ext` is form-namespaced (`ext:<form-d-tag>:<field-id>`), NOT `ext:ekw:`. Empirically already produces AMB-core tags identical to `ambToNostr` (16/16 in a prior diff).
- **`ambToNostr`/`nostrToAmb` signatures:** `ambToNostr(amb, {pubkey, timestamp, defaultRelayHint, relatedEvents}) → {success, data:{tags, content}}`; `nostrToAmb(event, {defaultLanguage?}) → {success, data: AmbLearningResource, warnings}`. `AmbLearningResource.ext?: Record<ns, Record<facet, Concept[]|string[]>>`.
- **Blast radius of retiring the template emit/parse:** `buildAMBResourceTags` (only `TemplateResourceForm.svelte`), `parseAMBResourceForForm` (`TemplateResourceForm.svelte`), `resolveResourceDTag` (`TemplateResourceForm.svelte`), `getFormReferenceFromResource` (`AMBResourceView.svelte`, `extensionMetadata.js` — **keep this helper**, non-template consumers), plus `form-to-amb.test.js`.
- **Preview bug:** `buildPreviewResource.js` runs `convertFormDataToAMB → ambToNostr` but never appends EKW/Konfi, so those facets are invisible in the wizard's live preview. Routing EKW/Konfi through `amb.ext` fixes this for free.

## Architecture

### Slice A — Template path onto the converter

**A1. Write — `src/lib/helpers/educational/formValuesToAmbJson.js` (new, pure):**
`formValuesToAmbJson(form, values, selectedConcepts) → AmbLearningResource`. Per `form.fields`, map by `field.output`:
- `amb:name/description/inLanguage/image/datePublished/dateCreated` → the AMB scalar/array property; `amb:id` → `amb.id`; `amb:license` → `amb.license = { id }`; `amb:isAccessibleForFree` → boolean; `amb:keywords` → `amb.keywords[]`.
- concept props (`amb:about/learningResourceType/educationalLevel/audience`) → `amb[prop] = selectedConcepts[fieldId].map(c => ({ id: c.id, type: 'Concept', prefLabel: c.labels }))` — **all languages** from `c.labels`.
- `creator` field → `amb.creator = value.map(c => c.pubkey ? { name:c.name, type:c.type, nostrPubkey:c.pubkey, relayHint } : { name, type, honorificPrefix, id:orcid, affiliation })` — let `ambToNostr` emit the `p`-tag for pubkey creators and `creator:*` for external (unifies creator handling through the converter).
- `amb-relation` field → `amb.hasPart`/`amb.isPartOf` (per the field's `amb:hasPart`/`amb:isPartOf` output) as relation refs; pass coordinates via the `relatedEvents` option so `ambToNostr` emits the `a`-tags.
- `field.output === 'ext'` → `amb.ext[form.dTag][field.id] = concepts` (form-namespaced ext).
- `external-urls` field → collected separately (see A2 — `r`-tags are Nostr-native, appended after, not an AMB property).

**A2. Write orchestration in `TemplateResourceForm.svelte#handleSubmit`:** `const { data } = ambToNostr(formValuesToAmbJson(form, values, selectedConcepts), { pubkey, defaultRelayHint });` → `tags = data.tags`, `content = data.content`. Then append the *edufeed extras* not produced by the converter: `r`-tags (external-urls values), the `["a","30168:<pub>:<d>", relay, "form"]` back-ref, NIP-32 `["L","metadata-form"]`/`["l", variantId, "metadata-form"]` (if a variant context exists), and image `["x", hash]` (if resolvable). Reuse `resolveResourceDTag` for the `d`-tag (converter sets `d` from `amb.id`; reconcile with the existing edit/create logic).

**A3. Read — `src/lib/helpers/educational/ambJsonToFormValues.js` (new, pure):** `ambJsonToFormValues(amb, form) → { values, selectedConcepts }` (inverse of A1), driven by `nostrToAmb(event)`. In `TemplateResourceForm.svelte` edit mode: `const { data: amb } = nostrToAmb(resourceEvent); const { values, selectedConcepts } = ambJsonToFormValues(amb, form);` → `initialValues`.

**A4. Retire:** delete `src/lib/helpers/forms/amb-emitters.js` and `buildAMBResourceTags`/`parseAMBResourceForForm`/`resolveResourceDTag` from `form-to-amb.js`. **Keep** `getFormReferenceFromResource` (move it to a small module, e.g. `src/lib/helpers/educational/formReference.js`, since `AMBResourceView`/`extensionMetadata` use it). Update/retire `form-to-amb.test.js`. Update the NIP-101-EDU doc's field-output section to state serialization is via `amb-nostr-converter` (the shapes are unchanged).

### Slice B — Wizard EKW/Konfi through `ambData.ext`

**B1.** In `convertFormDataToAMB` (`formDataToAmb.js`), build `amb.ext` from the EKW/Konfi form data with the **conformant two-namespace shape** (per the normative grammar above):
```js
amb.ext = {
  ekw:          { <facet>: [{id, type:'Concept', prefLabel:<all-lang labels>}], …, methodOther:[<string>…], bibleReference:[<string>…] },
  [EKW_KONFI_NS]: { zielgruppen:[<concepts>], themen:[<concepts>], dimensionen:[<concepts>], … }   // EKW_KONFI_NS = 'ekw.konfi'
}
```
`konfi` facets move under the `ekw.konfi` namespace (NOT `ekw['konfi:<slug>']`), keyed by bare slug. Non-konfi EKW facets stay under `ekw` (already legal). Source multi-language labels from the same `SelectedConcept.labels` the pickers carry (not hardcoded `:de`). Define `EKW_KONFI_NS` as one exported constant (in `ekwNamespace.js`) so the reverse-DNS swap is a one-liner.

**B2.** In `educational-actions.svelte.js`, **remove** the hand-appended `formDataToEkwTags(formData)` and `konfiTags` pushes (now emitted by `ambToNostr` from `amb.ext`). Keep `appendCreatorPTags`/`appendExternalUrlTags`/`appendVariantLabelTags`/`appendCoverColorTag`/image-`x` as-is (Nostr-native/edufeed extras).

**B3.** `buildPreviewResource.js` needs no change — it already calls `convertFormDataToAMB → ambToNostr`, so EKW/Konfi now appear in the preview automatically. Add a test asserting they do.

**B4. Read: EKW unchanged, Konfi namespace moves.** `parseEkwTagsToFormData` reads `ext:ekw:<facet>:…` (already legal) — unchanged. `parseKonfiTags` (`konfiTags.js`) keys every read on `KONFI_PREFIX` — repoint that single constant from `ext:ekw:konfi:` to `ext:${EKW_KONFI_NS}:` (= `ext:ekw.konfi:`), which moves both the (retiring) emit AND the surviving parse in lockstep. **No back-compat read of the old `ext:ekw:konfi:*`** — Bumble re-publishes existing events into the new namespace; between the relay fix and that re-publish, editing an un-migrated resource sees empty Konfi fields (deliberate, per the grammar note). `formDataToEkwTags.js` + the Konfi emit helpers (`emitKonfiVocabTags`/`emitKonfiScalarTags`) become unused for the write path — retire them only if no other caller remains (keep `parseKonfiTags`).

**B5. Conformance test (new):** assert every `ext:*` tag produced by a full EKW/Konfi resource has `ns` and `facet` free of `":"` (split on `:`, key matches `ext:<ns>:<facet>[:sub]` with `sub ∈ {id,type,name,prefLabel:<lang>}` or bare) — i.e. no key like `ext:ekw:konfi:*` survives. Round-trip `parseKonfiTags` over the new `ext:ekw.konfi:*` shape.

## Testing (TDD)

- **Golden equivalence (load-bearing):** for the same logical resource, assert template output (Slice A) === the tag set `ambToNostr` produces === (for AMB-core) the wizard's output. Reuse the prior diff harness. Pin the exact NIP-AMB tags.
- **Slice A round-trip:** `formValuesToAmbJson → ambToNostr → nostrToAmb → ambJsonToFormValues` returns the original form values + selectedConcepts (ids + labels); form-namespaced `ext` round-trips.
- **Creator unification:** a pubkey creator → single `p`-tag (no `creator:*`); an external creator → `creator:*` (no `p`), via the converter.
- **Slice B EKW/Konfi:** `convertFormDataToAMB` builds `amb.ext.ekw.<facet>` (non-konfi) and `amb.ext['ekw.konfi'].<slug>` (konfi); `ambToNostr` emits `ext:ekw:<facet>:…` and `ext:ekw.konfi:<slug>:…` for ALL languages, **all keys conformant (colon-free ns+facet)**; `parseEkwTagsToFormData` + the repointed `parseKonfiTags` round-trip it; an existing single-`de` resource that has ALREADY been re-published into the new namespace still reads. Preview now includes EKW/Konfi facets. Plus the **B5 conformance test** (no `ext:ekw:konfi:*` key emitted).
- **Blast-radius:** update `form-to-amb.test.js` (retirement), `AMBResourceView.test.js` (form back-ref still works via the kept helper), `educational-actions-tags.test.js` (EKW/Konfi now from `ambToNostr`), `buildPreviewResource.test.js` (EKW/Konfi present).
- **Full verification** + one E2E: publish a resource through the template form, assert the 30142 is NIP-AMB-conformant and identical in shape to the wizard's.

## Out of scope

- Wizard read-side convergence (the `getAMB*` readers + EKW/Konfi readers → `nostrToAmb`) — deferred; the existing readers stay.
- The Formstr `renderElement` synonym map (already shipped, separate).
- Any change to `amb-nostr-converter` itself (it's aligned; convergence only changes how edufeed *calls* it).

## Risks

- **`formValuesToAmbJson` fidelity** is the crux: it must map every template field type to the exact AMB property the converter expects, so output stays identical. Mitigation: the golden equivalence test pins it against `ambToNostr`; the prior empirical diff already showed AMB-core parity.
- **Creator representation:** moving pubkey creators into `amb.creator` with `nostrPubkey` (vs the wizard excluding them and hand-appending `p`) must produce the same single `p`-tag and no duplicate `creator:*`. Explicit test.
- **`d`-tag / content reconciliation:** `ambToNostr` sets `d` from `amb.id` and `content` from `description`; the template route's create/edit d-tag logic (`resolveResourceDTag`) must layer on top without double-`d` or losing the user URL. Explicit test (carried from the prior slice's Critical fix).
- **Relation refs:** template relations must pass through `relatedEvents` so `ambToNostr` emits `a`-tags with the right role; verify against the wizard's `buildRelatedEventsMap` pattern.
