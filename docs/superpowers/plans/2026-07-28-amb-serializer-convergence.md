# AMB-Serializer Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. There is a natural CHECKPOINT after Task 3 (Slice A complete) — pause there if the controller/user wants to test before Slice B.

**Goal:** One canonical AMB serializer — route the template form's kind-30142 write/read through `amb-nostr-converter` (`ambToNostr`/`nostrToAmb`), retiring in-app `amb-emitters`; and route the wizard's EKW/Konfi facets through `amb.ext` (fixing the live-preview gap, upgrading to multi-language).

**Architecture:** Two pure mappers (`formValuesToAmbJson`, `ambJsonToFormValues`) sit between the template form and the shared converter; edufeed-native extras (`r`-tags, form back-ref, NIP-32 labels, image `x`) are appended around the converter's output, mirroring the wizard. The wizard's `convertFormDataToAMB` gains an `amb.ext` builder so `ambToNostr` emits EKW/Konfi instead of hand-appended helpers.

**Tech Stack:** SvelteKit + Svelte 5, JSDoc, Vitest, `amb-nostr-converter` (installed dep), nostr-tools `nip19` (encode only).

**Spec:** `docs/superpowers/specs/2026-07-28-amb-serializer-convergence-design.md`. Stacks on `feature/nostr-metadata-forms`.

## Global Constraints

- Worktree `/home/laoc/coding/edufeed/edufeed-app/.claude/worktrees/nip101-forms-alignment`, branch `feature/nostr-metadata-forms`. Never the main-checkout path.
- pnpm; node-env tests `/** @vitest-environment node */`. `pnpm run check` 0 errors + `pnpm run lint` clean after every task.
- The convergence MUST NOT change published tag SHAPES vs today (except the intended EKW/Konfi `:de`-only → all-languages). The **golden equivalence test** is the gate: template output === `ambToNostr` output for the same resource.
- Creators with a pubkey use the NIP-AMB form `creator.id = "nostr:<npub>"` (NOT the deprecated `nostrPubkey` field); `ambToNostr` detects the `nostr:` id and emits the `["p", …, "creator"]` tag.
- `r`-tags (external URLs), the `["a","30168:…","form"]` back-ref, NIP-32 `metadata-form` labels, and image `["x",hash]` are edufeed extras — appended AFTER `ambToNostr`, not via the AMB object.
- Do NOT change `amb-nostr-converter` itself. `docs/` gitignored — `git add -f`.
- Do NOT run the full `pnpm test` suite while iterating; targeted files per task, full suite in the last task.

## Converter API (reference)

```
ambToNostr(amb, { pubkey, timestamp?, defaultRelayHint?, relatedEvents? }) → { success, data: { tags: string[][], content: string }, error?, warnings? }
nostrToAmb(event, { defaultLanguage? }) → { success, data: AmbLearningResource, warnings? }
// AmbLearningResource: { id, type: string[], name?, description?, inLanguage?: string[], keywords?: string[],
//   about?/learningResourceType?/educationalLevel?/audience?: Concept[], license?: { id }, isAccessibleForFree?: boolean,
//   image?, datePublished?, dateCreated?, creator?: (Person|Organization)[], hasPart?/isPartOf?: Ref[],
//   ext?: Record<ns, Record<facet, Concept[] | string[]>> }
// Concept = { id, type?: 'Concept', prefLabel?: { [lang]: string } }
// Person = { id?, type: 'Person', name, honorificPrefix?, affiliation? }   // id = "nostr:<npub>" for nostr creators
```
Import: `import { ambToNostr, nostrToAmb } from 'amb-nostr-converter';`

---

## SLICE A — Template path onto the converter

### Task 1: `formValuesToAmbJson` (write mapper) + golden equivalence

**Files:**
- Create: `src/lib/helpers/educational/formValuesToAmbJson.js`
- Test: `src/lib/__tests__/educational/formValuesToAmbJson.test.js` (new)

**Interfaces:**
- Produces: `formValuesToAmbJson(form, values, selectedConcepts) → { amb: AmbLearningResource, extras: { externalUrls: string[] } }`. `form = { pubkey, dTag, fields: FormField[] }`; `values` = raw field values (concept fields = array of `{id, labels?}` or the SelectedConcept objects); `selectedConcepts[fieldId]` = SelectedConcept[] (`{id, labels}`). Returns the AMB object PLUS the external-urls list (which are Nostr-native `r`-tags, appended by the caller, not an AMB property).
- Consumes: `FormField` shape (`{id, type, output, vocab?, options}`); `nip19.npubEncode`.

- [ ] **Step 1: Write the golden equivalence test** — `formValuesToAmbJson.test.js`. It builds a representative resource, runs `formValuesToAmbJson → ambToNostr`, and asserts the AMB-core tag set matches a hand-written NIP-AMB golden (the same 16-tag shape proven identical to the converter in the prior diff).

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';

const form = { pubkey: 'pk', dTag: 'demo', fields: [
  { id: 'title', type: 'text', output: 'amb:name' },
  { id: 'desc', type: 'textarea', output: 'amb:description' },
  { id: 'url', type: 'url', output: 'amb:id' },
  { id: 'lang', type: 'text', output: 'amb:inLanguage' },
  { id: 'kw', type: 'text-array', output: 'amb:keywords' },
  { id: 'about', type: 'select', vocab: { address: '39737:p:d' }, output: 'amb:about' },
  { id: 'lrt', type: 'select', vocab: { address: '39737:p:d2' }, output: 'amb:learningResourceType' },
  { id: 'lic', type: 'select', output: 'amb:license' },
  { id: 'free', type: 'checkbox', output: 'amb:isAccessibleForFree' },
  { id: 'creators', type: 'creator', output: 'amb:creator' },
  { id: 'img', type: 'url', output: 'amb:image' }
]};
const values = { title: 'Pythagoras', desc: 'A video', url: 'https://oer.example/res1', lang: 'de',
  kw: ['Geometrie', 'Mathe'], lic: 'https://creativecommons.org/licenses/by/4.0/', free: 'true',
  creators: [{ name: 'Jane Doe', type: 'Person' }], img: 'https://img.example/1.png' };
const selectedConcepts = {
  about: [{ id: 'http://w3id.org/kim/schulfaecher/s1017', labels: { de: 'Mathematik' } }],
  lrt: [{ id: 'https://w3id.org/kim/hcrt/video', labels: { de: 'Video' } }]
};

const norm = (tags) => tags.filter((t) => t[0] !== 'd').map((t) => t[0] + '\t' + (t[1] ?? '')).sort();

describe('formValuesToAmbJson → ambToNostr golden', () => {
  it('produces the NIP-AMB AMB-core tag set', () => {
    const { amb } = formValuesToAmbJson(form, values, selectedConcepts);
    const { success, data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    expect(success).toBe(true);
    const got = norm(data.tags);
    // the golden set (matches the converter + the retired buildAMBResourceTags, minus the d tag)
    expect(got).toEqual([
      'about:id\thttp://w3id.org/kim/schulfaecher/s1017',
      'about:prefLabel:de\tMathematik',
      'about:type\tConcept',
      'creator:name\tJane Doe',
      'creator:type\tPerson',
      'description\tA video',
      'image\thttps://img.example/1.png',
      'inLanguage\tde',
      'isAccessibleForFree\ttrue',
      'learningResourceType:id\thttps://w3id.org/kim/hcrt/video',
      'learningResourceType:prefLabel:de\tVideo',
      'learningResourceType:type\tConcept',
      'license:id\thttps://creativecommons.org/licenses/by/4.0/',
      'name\tPythagoras',
      't\tGeometrie',
      't\tMathe',
      'type\tLearningResource'
    ]);
  });
  it('emits a nostr p-tag for a creator with a pubkey (id = nostr:npub…), no creator:* for them', () => {
    const f2 = { ...form, fields: [{ id: 'creators', type: 'creator', output: 'amb:creator' }] };
    const { amb } = formValuesToAmbJson(f2, { creators: [{ name: 'Bob', type: 'Person', pubkey: 'aa'.repeat(32) }] }, {});
    expect(amb.creator[0].id).toMatch(/^nostr:npub1/);
    const { data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    expect(data.tags.some((t) => t[0] === 'p' && t[3] === 'creator')).toBe(true);
    expect(data.tags.some((t) => t[0] === 'creator:name')).toBe(false);
  });
  it('form ext fields map to amb.ext[formDTag][fieldId]', () => {
    const f3 = { pubkey: 'pk', dTag: 'myform', fields: [{ id: 'facet', type: 'select', vocab: { address: '39737:p:d' }, output: 'ext' }] };
    const { amb } = formValuesToAmbJson(f3, {}, { facet: [{ id: 'urn:x', labels: { de: 'X' } }] });
    expect(amb.ext.myform.facet).toEqual([{ id: 'urn:x', type: 'Concept', prefLabel: { de: 'X' } }]);
  });
  it('returns external-urls separately (Nostr-native r-tags, not an AMB property)', () => {
    const f4 = { pubkey: 'pk', dTag: 'd', fields: [{ id: 'refs', type: 'external-urls', output: 'amb:refs' }] };
    const { extras } = formValuesToAmbJson(f4, { refs: ['https://a.example'] }, {});
    expect(extras.externalUrls).toEqual(['https://a.example']);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`pnpm vitest run src/lib/__tests__/educational/formValuesToAmbJson.test.js`).

- [ ] **Step 3: Implement `formValuesToAmbJson.js`.** Walk `form.fields`; for each, read `values[field.id]` (or `selectedConcepts[field.id]` for vocab fields) and place it into the AMB object by `field.output`. Skeleton (fill each branch; the golden test pins correctness):

```js
import { nip19 } from 'nostr-tools';

const conceptList = (concepts) => (concepts || []).filter((c) => c?.id)
  .map((c) => ({ id: c.id, type: 'Concept', ...(c.labels && Object.keys(c.labels).length ? { prefLabel: c.labels } : {}) }));

/** @returns {{ amb: any, extras: { externalUrls: string[] } }} */
export function formValuesToAmbJson(form, values, selectedConcepts) {
  /** @type {any} */
  const amb = { type: ['LearningResource'] };
  const externalUrls = [];
  const CONCEPT_PROPS = new Set(['about', 'learningResourceType', 'educationalLevel', 'audience']);

  for (const field of form.fields) {
    const out = field.output || `amb:${field.id}`;
    const raw = values[field.id];

    if (field.type === 'external-urls') { if (Array.isArray(raw)) externalUrls.push(...raw.filter(Boolean)); continue; }
    if (field.type === 'creator') {
      amb.creator = (Array.isArray(raw) ? raw : []).map((c) => c.pubkey
        ? { name: c.name || '', type: c.type || 'Person', id: 'nostr:' + nip19.npubEncode(c.pubkey) }
        : { name: c.name || '', type: c.type || 'Person',
            ...(c.honorificPrefix ? { honorificPrefix: c.honorificPrefix } : {}),
            ...(c.orcid ? { id: c.orcid } : {}),
            ...(c.affiliationName ? { affiliation: { type: 'Organization', name: c.affiliationName } } : {}) });
      continue;
    }
    if (field.type === 'amb-relation') {
      const role = out === 'amb:isPartOf' ? 'isPartOf' : 'hasPart';
      amb[role] = (Array.isArray(raw) ? raw : []).filter((r) => r?.coordinate)
        .map((r) => ({ id: 'nostr:' + coordToNaddr(r.coordinate, r.relayHint), type: 'LearningResource' }));
      continue;
    }
    if (out === 'ext') {
      const ns = form.dTag;
      (amb.ext ??= {})[ns] ??= {};
      amb.ext[ns][field.id] = field.vocab ? conceptList(selectedConcepts[field.id]) : (Array.isArray(raw) ? raw : raw != null && raw !== '' ? [String(raw)] : []);
      continue;
    }
    const prop = out.startsWith('amb:') ? out.slice(4) : field.id;
    if (field.vocab || CONCEPT_PROPS.has(prop)) { const c = conceptList(selectedConcepts[field.id]); if (c.length) amb[prop] = c; continue; }
    if (prop === 'id') { if (raw) amb.id = String(raw); continue; }
    if (prop === 'license') { if (raw) amb.license = { id: String(raw) }; continue; }
    if (prop === 'isAccessibleForFree') { amb.isAccessibleForFree = raw === true || raw === 'true'; continue; }
    if (prop === 'keywords') { if (Array.isArray(raw) && raw.length) amb.keywords = raw.filter(Boolean); continue; }
    if (prop === 'inLanguage') { if (raw) amb.inLanguage = Array.isArray(raw) ? raw : [String(raw)]; continue; }
    // plain scalars: name, description, image, datePublished, dateCreated, …
    if (raw != null && raw !== '') amb[prop] = String(raw);
  }
  if (!amb.id) amb.id = `${form.pubkey}/${form.dTag}`; // ambToNostr needs an id → d; caller reconciles the real d-tag
  return { amb, extras: { externalUrls } };
}

/** @param {string} coordinate "30142:pub:d" @param {string} [relayHint] */
function coordToNaddr(coordinate, relayHint) {
  const [kind, pubkey, ...rest] = coordinate.split(':');
  return nip19.naddrEncode({ kind: Number(kind), pubkey, identifier: rest.join(':'), relays: relayHint ? [relayHint] : [] });
}
```

Iterate branches until the golden test passes. **Note:** the `amb-relation` mapping via `id: nostr:naddr` is one option; if the golden/round-trip shows `ambToNostr` needs the `relatedEvents` option instead to emit the `["a","30142:…",role]` shape the app expects, switch to passing `relatedEvents` from the caller and set `amb.hasPart = [{ id: 'nostr:naddr…' }]` — verify against `buildRelatedEventsMap` in `educational-actions.svelte.js` and add a relation-specific golden assertion.

- [ ] **Step 4: Run — PASS; `pnpm run check` 0 errors; commit**

```bash
git add src/lib/helpers/educational/formValuesToAmbJson.js src/lib/__tests__/educational/formValuesToAmbJson.test.js
git commit -m "feat(educational): formValuesToAmbJson — form values → AMB JSON for the shared converter"
```

---

### Task 2: `ambJsonToFormValues` (read mapper) + round-trip

**Files:**
- Create: `src/lib/helpers/educational/ambJsonToFormValues.js`
- Test: `src/lib/__tests__/educational/ambJsonToFormValues.test.js` (new)

**Interfaces:**
- Produces: `ambJsonToFormValues(amb, form) → { values, selectedConcepts }` — inverse of Task 1, driven by an `AmbLearningResource` (from `nostrToAmb`). For vocab fields, `selectedConcepts[fieldId] = [{ id, labels }]`; for scalars, `values[fieldId] = <value>`; for creator/relation/external-urls, `values[fieldId] = <array>`.
- Consumes: Task 1's mapping conventions (same `field.output` → AMB property correspondence, inverted).

- [ ] **Step 1: Write the round-trip test** — `ambJsonToFormValues.test.js`: `formValuesToAmbJson(form, values, sc) → ambToNostr → nostrToAmb → ambJsonToFormValues` returns the original values + concept ids/labels.

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr, nostrToAmb } from 'amb-nostr-converter';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';
import { ambJsonToFormValues } from '$lib/helpers/educational/ambJsonToFormValues.js';

// reuse the form/values/selectedConcepts from Task 1 (copy the constants in)
describe('ambJsonToFormValues round-trip', () => {
  it('recovers form values + concepts through the converter', () => {
    const { amb } = formValuesToAmbJson(form, values, selectedConcepts);
    const { data: tags } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    const event = { kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags: tags.tags };
    const { data: parsedAmb } = nostrToAmb(event);
    const { values: v, selectedConcepts: sc } = ambJsonToFormValues(parsedAmb, form);
    expect(v.title).toBe('Pythagoras');
    expect(v.kw).toEqual(['Geometrie', 'Mathe']);
    expect(v.free).toBe(true);
    expect(sc.about[0].id).toBe('http://w3id.org/kim/schulfaecher/s1017');
    expect(sc.about[0].labels.de).toBe('Mathematik');
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement `ambJsonToFormValues.js`** — inverse walk of `form.fields`, reading the AMB property named by `field.output` out of `amb` (concepts → `{id, labels: prefLabel}`, `license` → `amb.license.id`, `ext` → `amb.ext[form.dTag][field.id]`, creator → map `amb.creator` back incl. decoding `nostr:` ids to `{pubkey}`, relations → `amb.hasPart`/`isPartOf` → `{coordinate}`). Mirror Task 1's branch structure inverted.

- [ ] **Step 4: Run — PASS; `pnpm run check`; commit**

```bash
git add src/lib/helpers/educational/ambJsonToFormValues.js src/lib/__tests__/educational/ambJsonToFormValues.test.js
git commit -m "feat(educational): ambJsonToFormValues — AMB JSON → form values for edit prefill"
```

---

### Task 3: Wire TemplateResourceForm to the converter; retire amb-emitters

**Files:**
- Modify: `src/lib/components/forms/TemplateResourceForm.svelte` (write + read via the converter)
- Create: `src/lib/helpers/educational/formReference.js` (move `getFormReferenceFromResource` here)
- Modify: `src/lib/components/educational/AMBResourceView.svelte`, `src/lib/helpers/educational/extensionMetadata.js` (import from the new location)
- Delete: `src/lib/helpers/forms/amb-emitters.js`; remove `buildAMBResourceTags`/`parseAMBResourceForForm`/`resolveResourceDTag` from `src/lib/helpers/form-to-amb.js` (keep the file only if `getFormReferenceFromResource` isn't fully moved; prefer moving it and deleting `form-to-amb.js`)
- Modify: `src/lib/__tests__/form-to-amb.test.js` (retire emitter tests; keep any getFormReferenceFromResource test, moved), `src/lib/__tests__/amb-emitters*.test.js` (delete), `docs/nips/nip-101-edu.md` (note serialization via amb-nostr-converter)

**Interfaces:**
- Consumes: `formValuesToAmbJson` (T1), `ambJsonToFormValues` (T2), `ambToNostr`/`nostrToAmb`, `resolveResourceDTag` (re-home it into TemplateResourceForm or a small util — it's tiny; keep it).

- [ ] **Step 1: Rewrite `handleSubmit`** in TemplateResourceForm to use the converter:

```js
const { amb, extras } = formValuesToAmbJson(
  { pubkey: decoded.pubkey, dTag: decoded.identifier, fields: parsed.fields },
  rawValues, selectedConcepts
);
const { success, data, error: convErr } = ambToNostr(amb, { pubkey: manager.active.pubkey, defaultRelayHint: formRelay });
if (!success) throw new Error(convErr?.message || 'AMB conversion failed');
// reconcile the d-tag (edit keeps existing; create honors the emitted amb.id-derived d; else UUID)
const emittedD = data.tags.find((t) => t[0] === 'd')?.[1];
const dTag = resolveResourceDTag({ isEditMode, existingDTag: isEditMode && resourceEvent ? resourceEvent.tags.find((t) => t[0] === 'd')?.[1] : undefined, emittedD });
const tags = [
  ['d', dTag],
  ...data.tags.filter((t) => t[0] !== 'd'),
  ...extras.externalUrls.map((u) => ['r', u]),
  ['a', `30168:${decoded.pubkey}:${decoded.identifier}`, formRelay, 'form']
];
const content = data.content || '';
// (append NIP-32 metadata-form labels + image x-tag here if the template carries a variant/image — mirror the wizard)
```

- [ ] **Step 2: Rewrite the edit-prefill** (`initialValues`) to use `nostrToAmb` + `ambJsonToFormValues`:

```js
const { data: amb } = nostrToAmb(resourceEvent);
const { values: v, selectedConcepts: sc } = ambJsonToFormValues(amb, { pubkey: decoded.pubkey, dTag: decoded.identifier, fields: parsed.fields });
// merge v + sc into initialValues exactly as before
```

- [ ] **Step 3: Move `getFormReferenceFromResource`** to `src/lib/helpers/educational/formReference.js` (verbatim), update the two importers (`AMBResourceView.svelte`, `extensionMetadata.js`), then delete `amb-emitters.js` and the retired functions from `form-to-amb.js`.

- [ ] **Step 4: Update tests.** Delete `amb-emitters*.test.js`; in `form-to-amb.test.js` keep only a `getFormReferenceFromResource` test (moved to a `formReference.test.js`), remove emitter/buildAMBResourceTags/parseAMBResourceForForm cases. Add a TemplateResourceForm submit test (or extend an existing one) asserting the published 30142 has the NIP-AMB shape (name/description/content, concept `:id`+`:prefLabel`+`:type` no a-tag, `t` keywords, creator, `r` refs, `form` back-ref) — reuse the golden shape.

- [ ] **Step 5: Verify + commit.** `pnpm vitest run src/lib/__tests__/educational/ src/lib/components/__tests__/AMBResourceView.test.js src/lib/components/forms/__tests__/` ; `pnpm run check` 0 errors; `pnpm run lint`.

```bash
git add -A
git commit -m "refactor(forms): template path serializes via amb-nostr-converter; retire amb-emitters"
```

--- SLICE A COMPLETE (checkpoint). ---

## SLICE B — Wizard EKW/Konfi through amb.ext

> **CONFORMANCE (normative `ext:` grammar — see spec):** `ns` and `facet` MUST be colon-free. Non-konfi EKW facets stay under namespace `ekw` (`ext:ekw:gradeLevel:id` — already legal). **Konfi facets move under a SEPARATE namespace `org.edufeed.ekw.konfi`** (`ext:org.edufeed.ekw.konfi:<slug>:id`) — do NOT key them `ekw['konfi:<slug>']` (that emits the illegal 5-segment `ext:ekw:konfi:<slug>:id`). Define the konfi namespace as ONE exported constant `EKW_KONFI_NS = 'org.edufeed.ekw.konfi'` in `ekwNamespace.js` (DECIDED 2026-07-28: NIP-BOSS reverse-DNS). The legacy non-konfi `ekw` namespace stays `ekw` — do NOT reverse-DNS it.

### Task 4: `convertFormDataToAMB` builds `amb.ext` for EKW/Konfi

**Files:**
- Create: `src/lib/helpers/educational/formDataToAmbExt.js` (build the ext object from formData EKW/Konfi)
- Modify: `src/lib/helpers/educational/formDataToAmb.js` (`convertFormDataToAMB` sets `amb.ext`)
- Modify: `src/lib/helpers/educational/ekwNamespace.js` (add + export `EKW_KONFI_NS`)
- Test: `src/lib/__tests__/educational/formDataToAmbExt.test.js` (new)

**Interfaces:**
- Produces: `formDataToAmbExt(formData) → Record<string, Record<facet, Concept[] | string[]>> | undefined`. Two namespaces: `ekw` (non-konfi facets: concept facets carry ALL languages from `SelectedConcept.labels`; scalars `methodOther`/`bibleReference` as string arrays) and `[EKW_KONFI_NS]` (konfi facets keyed by bare slug — `zielgruppen`, `themen`, `dimensionen`, …).
- Adds: `EKW_KONFI_NS` exported const (`'org.edufeed.ekw.konfi'`) in `ekwNamespace.js`.

- [ ] **Step 1: Write the failing test** — assert `formDataToAmbExt` produces `{ ekw: { gradeLevel: [{id, type:'Concept', prefLabel:{de,en}}], methodOther: ['…'] }, 'org.edufeed.ekw.konfi': { zielgruppen: [{id, type:'Concept', prefLabel:{…}}] } }` from representative EKW/Konfi formData, and that feeding it to `ambToNostr` yields `ext:ekw:gradeLevel:id`/`:prefLabel:de`/`:prefLabel:en`/`:type` for EKW **and `ext:org.edufeed.ekw.konfi:zielgruppen:id`/`:prefLabel:<lang>`/`:type` for Konfi** (NOT `ext:ekw:konfi:zielgruppen:*`). Assert NO emitted key matches `ext:ekw:konfi:` (the illegal shape). Use existing `formDataToEkwTags.test.js`/`konfiTags.test.js` fixtures as the input-shape reference.

- [ ] **Step 2: Run — FAIL. Step 3: Implement** `formDataToAmbExt.js` reading the same formData fields `formDataToEkwTags`/`formDataToKonfiTags` read (mirror their field access), emitting Concept objects with full `labels` instead of `:de`-only, placing konfi facets under the `EKW_KONFI_NS` key. Wire it into `convertFormDataToAMB`: `const ext = formDataToAmbExt(formData); if (ext) amb.ext = ext;`.

- [ ] **Step 4: Run — PASS; `pnpm run check`; commit**

```bash
git add src/lib/helpers/educational/formDataToAmbExt.js src/lib/helpers/educational/formDataToAmb.js src/lib/__tests__/educational/formDataToAmbExt.test.js
git commit -m "feat(educational): convertFormDataToAMB builds amb.ext for EKW/Konfi (multi-language)"
```

---

### Task 5: Repoint Konfi read namespace; remove hand-appended EKW/Konfi; preview fixed; conformance + round-trip

> **CRITICAL DATA-FLOW FIX (found in Task-4 review — do NOT skip):** `formDataToAmbExt`'s Konfi branch reads raw `konfi<Scheme>Ids`/`Labels`/`Custom` + scalar `tagSlug` fields off the formData it receives. But the publish path is `ResourceFormWizard → buildResourceData(formData, {konfiTags}) → resourceData → createResource → convertFormDataToAMB(resourceData)`. `buildResourceData` is a WHITELIST (issue #46: "fields silently missing here never reach the published event") that today forwards the raw EKW fields BUT only the pre-built `konfiTags` array for Konfi — NOT the raw konfi scheme-key fields. So the moment Step 4 removes the konfiTags hand-append, **real Konfi publishes emit ZERO konfi facets** (the preview path bypasses `buildResourceData`, so preview keeps working and MASKS the regression). Task 5 MUST forward the raw konfi fields through `buildResourceData` AND test the real `resourceData` publish path, not the preview.

**Files:**
- Modify: `src/lib/helpers/educational/konfiTags.js` (repoint `KONFI_PREFIX` from `ext:ekw:konfi:` to `ext:${EKW_KONFI_NS}:` = `ext:org.edufeed.ekw.konfi:` — moves both retiring-emit and surviving-parse in lockstep)
- Modify: `src/lib/helpers/educational/buildResourceData.js` (**forward the raw konfi scheme-key fields** so `formDataToAmbExt` can build the Konfi namespace downstream)
- Modify: `src/lib/components/educational/ResourceFormWizard.svelte` (drop the now-unneeded `konfiTags: formDataToKonfiTags(...)` arg to `buildResourceData` — raw fields flow through instead)
- Modify: `src/lib/stores/educational-actions.svelte.js` (remove the `formDataToEkwTags`/`konfiTags` push loops)
- Modify: `src/lib/__tests__/educational-actions-tags.test.js` (add EKW+Konfi coverage through the real `resourceData` path), `src/lib/__tests__/buildResourceData.test.js` (raw konfi fields forwarded), `src/lib/__tests__/buildPreviewResource.test.js` (EKW/Konfi now via `ambToNostr`)
- Possibly delete: `src/lib/helpers/educational/formDataToEkwTags.js`, `formDataToKonfiTags.js`, `konfiTags.js` emit helpers (`emitKonfiVocabTags`/`emitKonfiScalarTags`) IF no remaining caller (keep the parsers `parseEkwTagsToFormData`/`parseKonfiTags`)

**Interfaces:** Consumes Task 4's `formDataToAmbExt`/`amb.ext` (emitted by `ambToNostr`) and `EKW_KONFI_NS`.

- [ ] **Step 1: Repoint Konfi read namespace.** In `konfiTags.js`, change `const KONFI_PREFIX = ${EKW_TAG_PREFIX}konfi:` to `` const KONFI_PREFIX = `ext:${EKW_KONFI_NS}:` `` (import `EKW_KONFI_NS` from `ekwNamespace.js`). This repoints `parseKonfiTags` (the surviving reader) to `ext:org.edufeed.ekw.konfi:<slug>:…`. **No back-compat read of the old `ext:ekw:konfi:*`** — deliberate. Update `konfiTags.test.js` expectations to the new prefix.

- [ ] **Step 2: Forward raw konfi fields through `buildResourceData`.** In `buildResourceData.js`, add the raw konfi scheme-key fields to the returned object, mirroring the unconditional EKW forwarding (lines 55-64). Drive it off the SAME static config `formDataToAmbExt` walks — import `BILDUNGSBEREICHE` and, for each field in `BILDUNGSBEREICHE.konfi.step4SubSteps`, forward `formData[`${schemeKey}Ids`]`, `formData[`${schemeKey}Labels`]`, `formData[`${schemeKey}Custom`]` (vocab fields) and `formData[tagSlug]` (scalar fields). (A small `collectKonfiRawFields(formData)` helper spread into the return object keeps it config-driven so it can't rot when sub-steps change.) Remove the `konfiTags` param from `buildResourceData`'s signature and from the `ResourceFormWizard.svelte` call site (the `formDataToKonfiTags(...)` construction is no longer needed). Add/extend `buildResourceData.test.js` asserting the raw konfi fields survive into the output.

- [ ] **Step 3: Write the failing publish-path tests.** In `educational-actions-tags.test.js`, build a resource through the REAL path — `buildResourceData(rawFormData, {about, hasNoUrl})` → `buildAMBEventTagsFromFormData(resourceData)` (or `createResource`) — and assert the resulting tags carry `ext:ekw:gradeLevel:id` (EKW) AND `ext:org.edufeed.ekw.konfi:zielgruppen:id` (Konfi). This is the test that catches the data-flow gap — it MUST go through `buildResourceData`, not hand-craft the formData and not use the preview path. **Conformance assertion (B5):** every `ext:*` key splits into `ext:<ns>:<facet>[:sub]` with `ns`/`facet` colon-free and `sub ∈ {id,type,name}`/`prefLabel:<lang>`/bare — NO `ext:ekw:konfi:*` key exists. In `buildPreviewResource.test.js`, assert the preview tags now include `ext:ekw:*` and `ext:org.edufeed.ekw.konfi:*`.

- [ ] **Step 4: Run — FAIL. Step 5: Remove** the `for (const t of ekwTags) tags.push(t)` and `for (const t of konfiTags) tags.push(t)` loops in `educational-actions.svelte.js#createResource` and `#updateResource` (EKW/Konfi now come from `ambToNostr` via `amb.ext`). Grep for any remaining caller of `formDataToEkwTags`/`formDataToKonfiTags`/`emitKonfiVocabTags`/`emitKonfiScalarTags`; delete the now-dead emit helpers only if none remain (keep the parsers). Re-run Step 3's tests → GREEN.

- [ ] **Step 6: Round-trip test** — assert a wizard resource's EKW/Konfi round-trips through `parseEkwTagsToFormData` + the repointed `parseKonfiTags` (read from `ext:org.edufeed.ekw.konfi:*`). Note: NO old-namespace back-compat — do NOT test that an un-migrated `ext:ekw:konfi:*` event still reads (deliberately ignored).

- [ ] **Step 7: Verify + commit.** `pnpm vitest run src/lib/__tests__/educational-actions-tags.test.js src/lib/__tests__/buildResourceData.test.js src/lib/__tests__/buildPreviewResource.test.js src/lib/__tests__/konfiRoundTrip.test.js src/lib/__tests__/parseEkwTagsToFormData.test.js src/lib/__tests__/konfiTags.test.js`; `pnpm run check`; `pnpm run lint`.

```bash
git add -A
git commit -m "refactor(educational): EKW/Konfi via ambToNostr; move Konfi to conformant ext:org.edufeed.ekw.konfi ns; fix live preview"
```

---

### Task 6: Full verification + E2E

- [ ] **Step 1: Full verification**, in order:
  1. `pnpm vitest run src/lib/__tests__/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/ src/lib/components/educational/__tests__/ scripts/lib/__tests__/` — PASS.
  2. `pnpm run check` — 0 errors.
  3. `pnpm run lint` — clean.
  4. `pnpm test` (full, once) — PASS modulo documented pre-existing flakes (inbox/DM parallel, GlobalFAB teardown race). Anything else tracing to this change must be fixed.
- [ ] **Step 2: E2E** — extend/confirm the amb-basic template E2E: publish a resource through the template form (now via the converter) and assert the 30142 is NIP-AMB-conformant; if the harness is available run it, else document honestly. Update `e2e/COVERAGE.md`.
- [ ] **Step 3: Commit** any test/E2E updates.

```bash
git add -A && git commit -m "test: full verification for AMB-serializer convergence"
```

---

### Task 7: Migrate existing Konfi events to the new namespace (GATED — after Task 6 verified)

**Authorization:** the key holder (`s.roertgen`) holds the EKW/Konfi signing key and authorized re-publishing existing events into the new namespace *after* confirming the new pipeline works. This rewrites LIVE data — treat it as a reviewed, dry-run-first migration script, NOT an automatic step.

**Files:**
- Create: `scripts/migrate-konfi-namespace.mjs` (Node, standalone; reuses the app's Nostr query/publish helpers or a minimal `WebSocket` client per [[verifying-nostr-queries-from-node]]).

**Preconditions (all must hold before running):** Tasks 1–6 complete and verified; the relay-side `nostr_amb.go` fix + `amb-nostr-converter` write/parse guards are live (coordinate with NIP-BOSS — otherwise re-published events may still be mis-indexed); a fresh dev-server smoke test of a new Konfi publish confirms the `ext:org.edufeed.ekw.konfi:*` shape round-trips end to end.

- [ ] **Step 1:** Query the AMB relays for kind-30142 events under `#l=ekw` and select **every ext-bearing event**, not only those carrying `ext:ekw:konfi:*` keys. List them (count, ids, d-tags) — **do not modify anything yet**.

  > **Do not select by konfi-key presence.** It looks right and is wrong. On the current corpus, 8 of 25 ext-bearing events carry only bare scalars (`ext:ekw:bibleReference`, `ext:ekw:methodOther`) and zero konfi keys. Those events are already NIP-conformant; their defect is that the pre-fix relay dropped 3-segment scalars from the index. Conversion runs at *index* time (nostrlib `typesense30142/replace.go`), so the only thing that re-indexes them is a re-publish. A konfi-keyed selector skips them and they stay invisible after the migration is declared done. `#l=ekw` is a verified-safe superset: a paginated scan of 8,476 kind-30142 events (2026-07-29) found **0** ext-bearing events lacking that label. (`ext:*` keys are multi-char and not REQ-filterable; `l` is.)
  >
  > Expected shape of the set: 25 ext-bearing of 32 labelled — 6 konfi-only, 5 konfi+scalar, 8 scalar-only, 6 already clean. Use this as the dry-run assertion.

- [ ] **Step 2: Dry run.** For each, build the re-published event: replace every `ext:ekw:konfi:<slug>:<sub>` tag key with `ext:org.edufeed.ekw.konfi:<slug>:<sub>` (mechanical prefix swap — values unchanged) **where present**, and re-sign unchanged where not; keep the same `d`-tag (replaceable → supersedes the old event), keep all other tags. **Always bump `created_at` and re-sign** so the event id changes — a byte-identical re-publish has a byte-identical id, and id-level dedupe exists in client caches and broadcast paths even though this relay's `ReplaceEvent` upserts unconditionally. Print a per-event before/after diff of the changed keys. Confirm no non-konfi tag is touched and the key count matches.
- [ ] **Step 3:** Present the dry-run summary to the key holder; get explicit go-ahead. Sign with the holder's key and publish (the holder runs it, or provides signing) to the AMB relays. **REQ each event back to verify** it landed with the new keys ([[relay-shadow-drops-kind1]]).
- [ ] **Step 4:** Spot-check in the app: open a migrated resource for edit → Konfi fields populate (proves the repointed `parseKonfiTags` reads the re-published shape). Record counts + verification in the ledger.

> **Sequencing:** between Slice B shipping and this migration completing, un-migrated resources show empty Konfi fields on edit (no back-compat read shim, deliberate). Run this migration promptly after Slice B + the relay/converter guards are live to minimize that window.

---

### Task 8: `parseExtensionTags` — normative left-anchored grammar (added 2026-07-29)

The read path still implemented the right-anchored heuristic (*"last segment = facet, prior segments joined by `:` = ns"*) that the amended NIP-AMB replaced. On conformant data it agrees with left-anchored parsing, so nothing broke — but it *guesses* at surplus-segment keys, which means edufeed-app kept happily reading un-migrated `ext:ekw:konfi:*` events that the relay and every other conformant consumer must drop. Landed here rather than in a second worktree because this branch already owns the file.

- [x] **Step 1:** Replace `parseTagKey` (`src/lib/helpers/educational/parseExtensionTags.js`) with left-anchored fixed arity, ported from `amb-nostr-converter@ff26856` `src/converters/nostrToAmb.ts`: split on `:`; offset 1 for `ext:`, 0 for legacy `ekw:`; `ns = segments[offset]`, `facet = segments[offset+1]`, `sub = segments.slice(offset+2).join(':')` or null; validate `sub ∈ {id, type, name, prefLabel:<lang>}` and return null otherwise. Delete the doc comment describing the old heuristic — it documented the bug.
- [x] **Step 2:** Give `sub === 'name'` a real branch. It is in the NIP's closed sub set, so it now passes validation and would otherwise be parsed, accepted, and silently dropped — the same failure class NIP-BOSS found in the converter's `reconstructExt`.
- [x] **Step 3:** `extensionMetadata.js` — `isFormDriven` compared `ns` against the full `30168:<pub>:<d>` coordinate, which is not a legal `<ns>` and no longer survives parsing. Compare against the form's bare `d`-tag instead and drop `formCoordToNs`.
- [x] **Step 4:** Tests — invert the form-coordinate case to assert it is *ignored*, add the conformant `ext:<form-d-tag>:*` replacement, and add negative cases for legacy konfi keys and unknown subs.

> **Intended behaviour change:** edufeed-app stops reading un-migrated `ext:ekw:konfi:*`. This matches the no-shim ruling — the two segmentations are indistinguishable, so conformant consumers must ignore them rather than guess. It makes Task 7 the thing that restores those facets, which is the point.

---

## Out of scope

Wizard read-side convergence (`getAMB*` + EKW/Konfi readers → `nostrToAmb`) — note Task 8 fixes the `parseExtensionTags` grammar *in place*, it does not route it through `nostrToAmb`; changes to `amb-nostr-converter`; the relay `nostr_amb.go` fix + converter guards (NIP-BOSS); the branch merge.

## Self-review notes

- **Spec coverage:** formValuesToAmbJson (T1) + golden equivalence; ambJsonToFormValues (T2) + round-trip; TemplateResourceForm rewrite + amb-emitters retirement + keep getFormReferenceFromResource (T3); wizard amb.ext for EKW/Konfi + multi-lang (T4); remove hand-append + preview fix + backward compat (T5); full verify + E2E (T6). All spec sections mapped.
- **Risks addressed:** golden equivalence test (T1) pins formValuesToAmbJson fidelity; creator nostr:npub p-tag test (T1); d-tag/content reconciliation reuses resolveResourceDTag (T3); relation refs flagged with a verify-against-buildRelatedEventsMap note (T1).
- **Type consistency:** `formValuesToAmbJson`/`ambJsonToFormValues`/`formDataToAmbExt` signatures and the `{ amb, extras }` shape are used consistently T1→T3; `amb.ext` shape (Concept[] with full prefLabel) consistent T1/T4.
