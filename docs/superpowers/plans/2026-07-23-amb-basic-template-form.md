# AMB-Basic Template-Driven Form Implementation Plan (Phase 1b, Slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A template-driven, strict-NIP-AMB-compliant learning-resource metadata form for the `amb` variant, reachable as a parallel route to `ResourceFormWizard`, built on a pure per-field-type emitter registry.

**Architecture:** Split field *serialization* from field *rendering*. A pure `amb-emitters.js` registry maps each field to an emitter (`value → NIP-AMB tags` + inverse `parse`); `form-to-amb.js` orchestrates by delegating per field. Rich edufeed inputs (creator, relation, external-urls) get thin registry-contract adapter components. A `templateNaddr` on the variant registry routes `/create/resource/[variant]` to a shared template renderer when set, else the untouched wizard.

**Tech Stack:** SvelteKit + Svelte 5 runes, JSDoc types, Vitest (node + jsdom), applesauce, nostr-tools `nip19` only (never for relay comm). The authoritative emission grammar is **NIP-AMB** (`naddr1qvzqqqrcvypzp0wzr7fmrcktw4sgemxh5zsq5auh08vnvlwf0x9anusn7pkft0zgqq9k2er4vejk2epdv9kky6ckr2a`).

**Spec:** `docs/superpowers/specs/2026-07-23-amb-basic-template-form-design.md`. Parent: the Phase-1a NIP-101 alignment (already merged into this branch). This plan STACKS on `feature/nostr-metadata-forms`.

## Global Constraints

- Work in the existing worktree `/home/laoc/coding/edufeed/edufeed-app/.claude/worktrees/nip101-forms-alignment` on branch `feature/nostr-metadata-forms`. **Never** write files by the main-checkout absolute path (`/home/laoc/coding/edufeed/edufeed-app/...` without `.claude/worktrees/...`) — it strays out of the worktree.
- Package manager **pnpm**. Unit tests: `pnpm vitest run <file>`; node-env files start with `/** @vitest-environment node */`, component files `jsdom`.
- `amb-emitters.js` MUST be pure JS — no Svelte imports — so the publish script and node tests can import it.
- Never use nostr-tools for relay communication; `nip19` encode/decode is fine.
- `pnpm run check` must stay at 0 errors after every task; `pnpm run lint` clean. Add JSDoc casts as needed (additive only).
- `docs/` is gitignored — any file under `docs/` needs `git add -f`.
- Paraglide: never put `@` directly before a `{param}` placeholder in a message value.
- **NIP-AMB compliance is binding** (verbatim from the spec): a concept emits `["<prop>:id", <external-URI>]` + `["<prop>:prefLabel:<lang>", <label>]` (one per language) + `["<prop>:type", "Concept"]` and **NO `a`-tag**. `a`-tags are only for relations (`isBasedOn`/`isPartOf`/`hasPart` → `["a","30142:<pub>:<d>",<relay>,<role>]`) and the back-ref `["a","30168:<pub>:<d>",<relay>,"form"]`. `ext` is `["ext:<form-d-tag>:<facet>:<sub>", …]` where `<form-d-tag>` is colon-free and contains no pubkey.
- Do NOT run the full `pnpm test` suite while iterating (Paraglide HMR storm + known-flaky inbox/DM files); use targeted files per task; run the full suite only in the final task.

---

## Emitter contract (referenced by all emitter tasks)

`amb-emitters.js` exports a registry and a resolver. Every emitter:

```js
/**
 * @typedef {Object} EmitCtx
 * @property {import('./format.js').FormField} field
 * @property {string} prop        // AMB property from field.output ('amb:<prop>' → <prop>), or '' for renderElement-keyed emitters
 * @property {string} formDTag    // the form template's d-tag (colon-free), for ext namespacing
 * @property {string} defaultLang // fallback language, 'de'
 *
 * @typedef {Object} AmbEmitter
 * @property {(value:any, ctx:EmitCtx) => string[][]} emit
 * @property {(event:import('nostr-tools').NostrEvent, ctx:EmitCtx) => { value:any, concepts?:any[] }} parse
 */
```

Emitter selection (`resolveEmitter(field)`): first by `field.type` for the composite field types `creator` / `amb-relation` / `external-urls`; else by AMB prop for `about`/`learningResourceType`/`educationalLevel`/`audience` (concept), `keywords`, `isAccessibleForFree` (boolean), `description`, `id` (d-tag), `license`; else the default scalar emitter; `ext` output routes to the ext emitter.

The value a field hands its emitter: for **vocab (concept) fields** it's the `SelectedConcept[]` from `selectedConcepts[field.id]`; for everything else `values[field.id]`.

---

### Task 1: Emitter registry + scalar/typed/concept/ext emitters + compliance rewrite

**Files:**
- Create: `src/lib/helpers/forms/amb-emitters.js`
- Modify: `src/lib/helpers/form-to-amb.js` (rewrite `buildAMBResourceTags` + `parseAMBResourceForForm` to delegate; keep signatures)
- Test: `src/lib/__tests__/amb-emitters.test.js` (new)
- Modify: `src/lib/__tests__/form-to-amb.test.js`, `src/lib/__tests__/forms.interop.test.js` (drop concept-a-tag expectations)

**Interfaces:**
- Produces: `resolveEmitter(field) → AmbEmitter`; named emitters `scalarEmitter`, `booleanEmitter`, `descriptionEmitter`, `dtagEmitter`, `conceptEmitter`, `keywordsEmitter`, `licenseEmitter`, `extEmitter`, and the registry object. `buildAMBResourceTags`/`parseAMBResourceForForm` keep their current signatures (consumed by `create-resource/+page.svelte`).
- Consumes: `FormField`/`FormFieldOption` from `./format.js`; `SelectedConcept` typedef stays in `form-to-amb.js`.

- [ ] **Step 1: Baseline** — confirm the current forms/amb tests pass before changes.

Run: `pnpm vitest run src/lib/__tests__/form-to-amb.test.js src/lib/__tests__/forms.interop.test.js`
Expected: PASS.

- [ ] **Step 2: Write failing emitter tests** — `src/lib/__tests__/amb-emitters.test.js`. Golden values come from the NIP-AMB spec's Example 1.

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

const ctx = (over = {}) => ({ field: { id: 'x', type: 'text', options: {} }, prop: '', formDTag: 'amb-basic', defaultLang: 'de', ...over });
const evt = (tags) => ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('scalar emitter', () => {
  it('emits and parses a flat scalar', () => {
    const field = { id: 'title', type: 'text', output: 'amb:name', options: {} };
    const em = resolveEmitter(field);
    expect(em.emit('Hello', ctx({ field, prop: 'name' }))).toEqual([['name', 'Hello']]);
    expect(em.parse(evt([['name', 'Hello']]), ctx({ field, prop: 'name' })).value).toBe('Hello');
  });
  it('repeats a tag per array element (inLanguage)', () => {
    const field = { id: 'lang', type: 'text', output: 'amb:inLanguage', options: {} };
    const em = resolveEmitter(field);
    expect(em.emit(['de', 'en'], ctx({ field, prop: 'inLanguage' }))).toEqual([
      ['inLanguage', 'de'],
      ['inLanguage', 'en']
    ]);
  });
});

describe('boolean / description / dtag / license emitters', () => {
  it('boolean isAccessibleForFree', () => {
    const field = { id: 'free', type: 'checkbox', output: 'amb:isAccessibleForFree', options: {} };
    const em = resolveEmitter(field);
    expect(em.emit(true, ctx({ field, prop: 'isAccessibleForFree' }))).toEqual([['isAccessibleForFree', 'true']]);
    expect(em.emit('false', ctx({ field, prop: 'isAccessibleForFree' }))).toEqual([['isAccessibleForFree', 'false']]);
    expect(em.parse(evt([['isAccessibleForFree', 'true']]), ctx({ field, prop: 'isAccessibleForFree' })).value).toBe(true);
  });
  it('description emits description + content marker', () => {
    const field = { id: 'desc', type: 'textarea', output: 'amb:description', options: {} };
    const em = resolveEmitter(field);
    // description emitter returns the description tag AND a sentinel ['content', v]
    // that buildAMBResourceTags lifts into the event content field.
    expect(em.emit('A video', ctx({ field, prop: 'description' }))).toEqual([
      ['description', 'A video'],
      ['content', 'A video']
    ]);
  });
  it('id maps to d tag', () => {
    const field = { id: 'ident', type: 'text', output: 'amb:id', options: {} };
    const em = resolveEmitter(field);
    expect(em.emit('https://oer.example/1', ctx({ field, prop: 'id' }))).toEqual([['d', 'https://oer.example/1']]);
  });
  it('license maps to license:id', () => {
    const field = { id: 'lic', type: 'select', output: 'amb:license', options: {} };
    const em = resolveEmitter(field);
    expect(em.emit('https://creativecommons.org/licenses/by/4.0/', ctx({ field, prop: 'license' }))).toEqual([
      ['license:id', 'https://creativecommons.org/licenses/by/4.0/']
    ]);
  });
});

describe('concept emitter (NIP-AMB compliant — no a-tag, multi-lang)', () => {
  const field = { id: 'about', type: 'select', output: 'amb:about', vocab: { address: '39737:p:d', relay: 'wss://r' }, options: {} };
  const concepts = [
    { id: 'http://w3id.org/kim/schulfaecher/s1017', nostrCoord: '39738:p:s1017', relay: 'wss://r', labels: { de: 'Mathematik', en: 'Maths' } }
  ];
  it('emits :id / :prefLabel:<lang> (all langs) / :type, and NO a-tag', () => {
    const tags = resolveEmitter(field).emit(concepts, ctx({ field, prop: 'about' }));
    expect(tags).toEqual([
      ['about:id', 'http://w3id.org/kim/schulfaecher/s1017'],
      ['about:prefLabel:de', 'Mathematik'],
      ['about:prefLabel:en', 'Maths'],
      ['about:type', 'Concept']
    ]);
    expect(tags.some((t) => t[0] === 'a')).toBe(false);
  });
  it('parses concepts back by external URI (no a-tag reliance)', () => {
    const parsed = resolveEmitter(field).parse(
      evt([
        ['about:id', 'http://w3id.org/kim/schulfaecher/s1017'],
        ['about:prefLabel:de', 'Mathematik'],
        ['about:type', 'Concept']
      ]),
      ctx({ field, prop: 'about' })
    );
    expect(parsed.value).toEqual(['http://w3id.org/kim/schulfaecher/s1017']);
    expect(parsed.concepts[0].id).toBe('http://w3id.org/kim/schulfaecher/s1017');
    expect(parsed.concepts[0].labels.de).toBe('Mathematik');
  });
});

describe('keywords emitter (t tags)', () => {
  const field = { id: 'kw', type: 'text-array', output: 'amb:keywords', options: {} };
  it('emits t tags and parses them back', () => {
    const em = resolveEmitter(field);
    expect(em.emit(['Pythagoras', 'Geometrie'], ctx({ field, prop: 'keywords' }))).toEqual([
      ['t', 'Pythagoras'],
      ['t', 'Geometrie']
    ]);
    expect(em.parse(evt([['t', 'Pythagoras'], ['t', 'Geometrie']]), ctx({ field, prop: 'keywords' })).value).toEqual([
      'Pythagoras',
      'Geometrie'
    ]);
  });
});

describe('ext emitter (colon-free form-d-tag namespace)', () => {
  const field = { id: 'bistum', type: 'select', output: 'ext', vocab: { address: '39737:p:d', relay: 'wss://r' }, options: {} };
  it('namespaces by the form d-tag, not by pubkey/coord', () => {
    const concepts = [{ id: 'https://w3id.org/kim/ekw/bistum/hannover', nostrCoord: '39738:p:h', relay: '', labels: { de: 'Hannover' } }];
    const tags = resolveEmitter(field).emit(concepts, ctx({ field, prop: '', formDTag: 'ekw-full' }));
    expect(tags).toEqual([
      ['ext:ekw-full:bistum:id', 'https://w3id.org/kim/ekw/bistum/hannover'],
      ['ext:ekw-full:bistum:prefLabel:de', 'Hannover'],
      ['ext:ekw-full:bistum:type', 'Concept']
    ]);
    expect(tags.some((t) => t[0] === 'a')).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.test.js`
Expected: FAIL — `$lib/helpers/forms/amb-emitters.js` not found.

- [ ] **Step 4: Implement `src/lib/helpers/forms/amb-emitters.js`**

```js
/**
 * Pure NIP-AMB emitter registry: each form field type / output maps to an
 * emitter that serializes a form value to NIP-AMB kind-30142 tags and parses
 * them back. No Svelte imports (usable from node scripts and tests).
 *
 * NIP-AMB grammar (authority: the NIP-AMB spec):
 *  - concept: ["<prop>:id", uri], ["<prop>:prefLabel:<lang>", label]*, ["<prop>:type","Concept"] — NO a-tag
 *  - ext: ["ext:<form-d-tag>:<facet>:<sub>", value] (form-d-tag colon-free, no pubkey)
 *  - keywords: ["t", kw]*   license: ["license:id", uri]   id: ["d", uri]
 *  - description also mirrors into the event content field
 */

/**
 * @typedef {Object} EmitCtx
 * @property {import('./format.js').FormField} field
 * @property {string} prop
 * @property {string} formDTag
 * @property {string} defaultLang
 *
 * @typedef {Object} AmbEmitter
 * @property {(value:any, ctx:EmitCtx) => string[][]} emit
 * @property {(event:import('nostr-tools').NostrEvent, ctx:EmitCtx) => { value:any, concepts?:any[] }} parse
 */

const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** Default: flat ["<prop>", value], arrays repeat. */
export const scalarEmitter = {
  emit: (value, { prop }) => asArray(value).map((v) => [prop, String(v)]),
  parse: (event, { prop }) => {
    const vals = event.tags.filter((t) => t[0] === prop && t[1]).map((t) => t[1]);
    return { value: vals.length === 0 ? '' : vals.length === 1 ? vals[0] : vals };
  }
};

export const booleanEmitter = {
  emit: (value, { prop }) => [[prop, value === true || value === 'true' ? 'true' : 'false']],
  parse: (event, { prop }) => {
    const t = event.tags.find((t) => t[0] === prop);
    return { value: t ? t[1] === 'true' : false };
  }
};

export const descriptionEmitter = {
  emit: (value, { prop }) => (value ? [[prop, String(value)], ['content', String(value)]] : []),
  parse: (event, { prop }) => {
    const t = event.tags.find((t) => t[0] === prop);
    return { value: t ? t[1] : event.content || '' };
  }
};

export const dtagEmitter = {
  emit: (value) => (value ? [['d', String(value)]] : []),
  parse: (event) => ({ value: event.tags.find((t) => t[0] === 'd')?.[1] || '' })
};

export const licenseEmitter = {
  emit: (value) => (value ? [['license:id', String(value)]] : []),
  parse: (event) => ({ value: event.tags.find((t) => t[0] === 'license:id')?.[1] || '' })
};

export const keywordsEmitter = {
  emit: (value) => asArray(value).filter(Boolean).map((v) => ['t', String(v)]),
  parse: (event) => ({ value: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]) })
};

/** keyBase for a concept/ext field: AMB prop, or ext:<form-d-tag>:<facet>. */
function conceptKeyBase({ field, prop, formDTag }) {
  return (field.output === 'ext') ? `ext:${formDTag}:${field.id}` : prop;
}

export const conceptEmitter = {
  emit: (concepts, ctx) => {
    const kb = conceptKeyBase(ctx);
    const out = [];
    for (const c of asArray(concepts)) {
      if (!c?.id) continue;
      out.push([`${kb}:id`, c.id]);
      for (const [lang, label] of Object.entries(c.labels || {})) out.push([`${kb}:prefLabel:${lang}`, label]);
      out.push([`${kb}:type`, 'Concept']);
    }
    return out;
  },
  parse: (event, ctx) => {
    const kb = conceptKeyBase(ctx);
    /** @type {{id:string,labels:Record<string,string>,nostrCoord:string,relay:string}[]} */
    const concepts = [];
    let current = null;
    for (const t of event.tags) {
      if (t[0] === `${kb}:id` && t[1]) {
        current = { id: t[1], labels: {}, nostrCoord: '', relay: '' };
        concepts.push(current);
      } else if (current && t[0]?.startsWith(`${kb}:prefLabel:`) && t[1]) {
        current.labels[t[0].slice(`${kb}:prefLabel:`.length)] = t[1];
      }
    }
    return { value: concepts.map((c) => c.id), concepts };
  }
};

export const extEmitter = conceptEmitter; // ext concept fields share the concept shape; keyBase differs via conceptKeyBase

const CONCEPT_PROPS = new Set(['about', 'learningResourceType', 'educationalLevel', 'audience']);

/**
 * @param {import('./format.js').FormField} field
 * @returns {AmbEmitter}
 */
export function resolveEmitter(field) {
  // composite field types are registered in Task 2-4 (creator/amb-relation/external-urls)
  const byType = COMPOSITE_EMITTERS[field.type];
  if (byType) return byType;

  if (field.output === 'ext') return extEmitter;
  const prop = (field.output || `amb:${field.id}`).startsWith('amb:')
    ? (field.output || `amb:${field.id}`).slice(4)
    : field.id;

  if (field.vocab || CONCEPT_PROPS.has(prop)) return conceptEmitter;
  if (prop === 'keywords') return keywordsEmitter;
  if (prop === 'isAccessibleForFree') return booleanEmitter;
  if (prop === 'description') return descriptionEmitter;
  if (prop === 'id') return dtagEmitter;
  if (prop === 'license') return licenseEmitter;
  return scalarEmitter;
}

/** Registry for composite field types; populated by Task 2-4 via registerCompositeEmitter. */
export const COMPOSITE_EMITTERS = /** @type {Record<string, AmbEmitter>} */ ({});
export function registerCompositeEmitter(type, emitter) {
  COMPOSITE_EMITTERS[type] = emitter;
}

/** Derive the AMB prop for a field ('amb:<prop>' → <prop>, else field id). */
export function fieldProp(field) {
  const o = field.output || `amb:${field.id}`;
  return o.startsWith('amb:') ? o.slice(4) : field.id;
}
```

- [ ] **Step 5: Run the emitter tests**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.test.js`
Expected: PASS.

- [ ] **Step 6: Rewrite `buildAMBResourceTags` + `parseAMBResourceForForm` to delegate**

Replace the bodies in `src/lib/helpers/form-to-amb.js` (keep the `SelectedConcept`/`ParsedFormForSerialization` typedefs and `getFormReferenceFromResource`; delete `emitForTarget`):

```js
import { resolveEmitter, fieldProp } from './forms/amb-emitters.js';

export function buildAMBResourceTags({ form, formRelay, values, selectedConcepts }) {
  /** @type {string[][]} */
  const out = [];
  for (const field of form.fields) {
    const emitter = resolveEmitter(field);
    const value = field.vocab ? selectedConcepts[field.id] : values[field.id];
    const ctx = { field, prop: fieldProp(field), formDTag: form.dTag, defaultLang: 'de' };
    for (const tag of emitter.emit(value, ctx)) out.push(tag);
  }
  out.push(['a', `30168:${form.pubkey}:${form.dTag}`, formRelay, 'form']);
  return out;
}

export function parseAMBResourceForForm(event, form) {
  /** @type {Record<string, string|string[]>} */
  const values = {};
  /** @type {Record<string, SelectedConcept[]>} */
  const selectedConcepts = {};
  for (const field of form.fields) {
    const emitter = resolveEmitter(field);
    const ctx = { field, prop: fieldProp(field), formDTag: form.dTag, defaultLang: 'de' };
    const { value, concepts } = emitter.parse(event, ctx);
    if (concepts) selectedConcepts[field.id] = concepts;
    if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      values[field.id] = value;
    }
  }
  return { values, selectedConcepts };
}
```

Note: the `['content', v]` tag emitted by `descriptionEmitter` is lifted into the event's `content` field by the create-resource route (Task 5), which strips it from tags. For this task it's fine for `buildAMBResourceTags` to return it as a pseudo-tag; the route handles the lift. (If you prefer, filter `['content', …]` out of the returned tag array here and return the content string separately — but that changes the signature; keep the pseudo-tag and lift in the route.)

- [ ] **Step 7: Update the affected existing tests**

In `src/lib/__tests__/form-to-amb.test.js` and `src/lib/__tests__/forms.interop.test.js`, any assertion expecting an `["a","39738:…",role]` concept tag or the old `ext:<30168:pub:d>:…` namespace must change: concept fields now emit no a-tag; ext uses `ext:<form-dtag>:<field-id>`. The option-field label↔id round-trip test from Phase-1a stays valid (scalarEmitter preserves it — verify: scalarEmitter emits raw values; the option-label mapping previously in `emitForTarget` must be re-homed). **Important:** the Phase-1a option-label emission (map optionId→label on emit, label→optionId on parse) lived in `emitForTarget`/`parseAMBResourceForForm`. Re-home it into `scalarEmitter`: on emit, if `ctx.field.options?.options?.length`, map each value through id→label; on parse, map label→id and `';'`-join. Add this to `scalarEmitter` and keep the Phase-1a `form-to-amb.test.js` option round-trip test green.

Amend `scalarEmitter`:

```js
export const scalarEmitter = {
  emit: (value, { field, prop }) => {
    const opts = field.options?.options;
    const byId = opts?.length ? new Map(opts.map((o) => [o.id, o.label])) : null;
    const vals = Array.isArray(value) ? value : byId ? String(value).split(';') : asArray(value);
    return vals.filter((v) => v !== undefined && v !== null && v !== '')
      .map((v) => [prop, byId ? (byId.get(String(v)) ?? String(v)) : String(v)]);
  },
  parse: (event, { field, prop }) => {
    const vals = event.tags.filter((t) => t[0] === prop && t[1]).map((t) => t[1]);
    if (vals.length === 0) return { value: '' };
    const opts = field.options?.options;
    if (opts?.length) {
      const byLabel = new Map(opts.map((o) => [o.label, o.id]));
      return { value: vals.map((v) => byLabel.get(v) ?? v).join(';') };
    }
    return { value: vals.length === 1 ? vals[0] : vals };
  }
};
```

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.test.js src/lib/__tests__/form-to-amb.test.js src/lib/__tests__/forms.interop.test.js`
Expected: PASS (update golden expectations as described). Then `pnpm run check` → 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/helpers/forms/amb-emitters.js src/lib/helpers/form-to-amb.js src/lib/__tests__/amb-emitters.test.js src/lib/__tests__/form-to-amb.test.js src/lib/__tests__/forms.interop.test.js
git commit -m "feat(forms): NIP-AMB emitter registry + strict-compliance rewrite of form-to-amb (drop concept a-tags, fix ext namespace)"
```

---

### Task 2: Creator emitter + CreatorFieldAdapter

**Files:**
- Modify: `src/lib/helpers/forms/amb-emitters.js` (add `creatorEmitter`, register `creator`)
- Create: `src/lib/components/forms/fields/CreatorFieldAdapter.svelte`
- Modify: `src/lib/config/form-field-types.js` (register `creator → CreatorFieldAdapter`)
- Test: `src/lib/__tests__/amb-emitters.creator.test.js` (new); `src/lib/components/forms/__tests__/CreatorFieldAdapter.test.js` (new)

**Interfaces:**
- Consumes: `registerCompositeEmitter`, `AmbEmitter` from Task 1; `Creator` typedef from `CreatorInput.svelte` (`{ name, type:'Person'|'Organization', pubkey?, affiliationName?, honorificPrefix?, orcid? }`).
- Produces: `creatorEmitter`; component registered under type `creator` with the registry contract `{ field, value, error, readonly, onchange }` where `value` is `Creator[]`.

- [ ] **Step 1: Write failing emitter test** — golden from NIP-AMB Example 2 (`src/lib/__tests__/amb-emitters.creator.test.js`):

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

const field = { id: 'creators', type: 'creator', output: 'amb:creator', options: {} };
const ctx = { field, prop: 'creator', formDTag: 'amb-basic', defaultLang: 'de' };
const evt = (tags) => ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('creator emitter (NIP-AMB)', () => {
  it('nostr-identity creator → p-tag only', () => {
    const value = [{ name: 'Alice', type: 'Person', pubkey: 'abc123', relayHint: 'wss://r' }];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([['p', 'abc123', 'wss://r', 'creator']]);
  });
  it('external creator → creator:* flattened (name, type, honorific, orcid, affiliation)', () => {
    const value = [{
      name: 'Prof. John Doe', type: 'Person', honorificPrefix: 'Prof.',
      orcid: 'https://orcid.org/0000-0009-8765-4321', affiliationName: 'Stanford University'
    }];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([
      ['creator:id', 'https://orcid.org/0000-0009-8765-4321'],
      ['creator:name', 'Prof. John Doe'],
      ['creator:type', 'Person'],
      ['creator:honorificPrefix', 'Prof.'],
      ['creator:affiliation:name', 'Stanford University'],
      ['creator:affiliation:type', 'Organization']
    ]);
  });
  it('parses p-tag and flattened creators back', () => {
    const parsed = resolveEmitter(field).parse(evt([
      ['p', 'abc123', 'wss://r', 'creator'],
      ['creator:name', 'Jane'],
      ['creator:type', 'Organization']
    ]), ctx);
    expect(parsed.value).toEqual([
      { name: '', type: 'Person', pubkey: 'abc123', relayHint: 'wss://r' },
      { name: 'Jane', type: 'Organization' }
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.creator.test.js`
Expected: FAIL (creator type resolves to scalar today).

- [ ] **Step 3: Implement `creatorEmitter` and register it** — append to `amb-emitters.js`:

```js
/** NIP-AMB creator/contributor: p-tag when pubkey present, else flattened creator:*. */
export const creatorEmitter = {
  emit: (value, { prop }) => {
    const role = prop === 'contributor' ? 'contributor' : 'creator';
    const key = role;
    const out = [];
    for (const c of asArray(value)) {
      if (!c) continue;
      if (c.pubkey) {
        out.push(['p', c.pubkey, c.relayHint || '', role]);
        continue;
      }
      if (c.orcid) out.push([`${key}:id`, c.orcid]);
      out.push([`${key}:name`, c.name || '']);
      out.push([`${key}:type`, c.type || 'Person']);
      if (c.honorificPrefix) out.push([`${key}:honorificPrefix`, c.honorificPrefix]);
      if (c.affiliationName) {
        out.push([`${key}:affiliation:name`, c.affiliationName]);
        out.push([`${key}:affiliation:type`, 'Organization']);
      }
    }
    return out;
  },
  parse: (event, { prop }) => {
    const role = prop === 'contributor' ? 'contributor' : 'creator';
    const key = role;
    /** @type {any[]} */
    const creators = [];
    for (const t of event.tags) {
      if (t[0] === 'p' && t[3] === role) {
        creators.push({ name: '', type: 'Person', pubkey: t[1], relayHint: t[2] || '' });
      }
    }
    let current = null;
    for (const t of event.tags) {
      if (t[0] === `${key}:name`) { current = { name: t[1] || '', type: 'Person' }; creators.push(current); }
      else if (current && t[0] === `${key}:type`) current.type = t[1];
      else if (current && t[0] === `${key}:honorificPrefix`) current.honorificPrefix = t[1];
      else if (current && t[0] === `${key}:affiliation:name`) current.affiliationName = t[1];
      else if (current && t[0] === `${key}:id`) current.orcid = t[1];
    }
    return { value: creators };
  }
};
registerCompositeEmitter('creator', creatorEmitter);
```

(Note the `:id` for an external creator is emitted before `:name` per the NIP-AMB example, but parsed after — the parse loop keys new creators on `:name`; attach `:id` to the current creator only if it appears after its `:name`. The Example-2 ordering has `creator:id` first; to match, emit `:id` first as shown, and on parse, when a `:id` appears before any `:name`, buffer it. Simplify: buffer a pending orcid.) Replace the flattened-parse loop with:

```js
    let current = null, pendingOrcid = null;
    for (const t of event.tags) {
      if (t[0] === `${key}:id`) { pendingOrcid = t[1]; }
      else if (t[0] === `${key}:name`) { current = { name: t[1] || '', type: 'Person' }; if (pendingOrcid) { current.orcid = pendingOrcid; pendingOrcid = null; } creators.push(current); }
      else if (current && t[0] === `${key}:type`) current.type = t[1];
      else if (current && t[0] === `${key}:honorificPrefix`) current.honorificPrefix = t[1];
      else if (current && t[0] === `${key}:affiliation:name`) current.affiliationName = t[1];
    }
```

- [ ] **Step 4: Run the emitter test**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.creator.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing adapter component test** — `src/lib/components/forms/__tests__/CreatorFieldAdapter.test.js` (jsdom). Mock `CreatorInput` to a stub that calls `onchange` with a known array, and assert the adapter forwards it:

```js
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CreatorFieldAdapter from '$lib/components/forms/fields/CreatorFieldAdapter.svelte';

vi.mock('$lib/components/educational/CreatorInput.svelte', async () => {
  const Stub = (await import('./CreatorFieldAdapterStub.svelte')).default;
  return { default: Stub };
});

describe('CreatorFieldAdapter', () => {
  it('emits Creator[] via onchange when the inner input changes', async () => {
    const onchange = vi.fn();
    render(CreatorFieldAdapter, {
      field: { id: 'creators', label: 'Creators', options: {} },
      value: [], error: null, readonly: false, onchange
    });
    // the stub auto-fires onchange([{name:'Alice',type:'Person'}]) on mount
    expect(onchange).toHaveBeenCalledWith([{ name: 'Alice', type: 'Person' }]);
  });
});
```

Create the stub `src/lib/components/forms/__tests__/CreatorFieldAdapterStub.svelte`:

```svelte
<script>
  let { creators = [], onchange } = $props();
  $effect(() => { onchange([{ name: 'Alice', type: 'Person' }]); });
</script>
<div data-testid="creator-stub">{creators.length}</div>
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/lib/components/forms/__tests__/CreatorFieldAdapter.test.js`
Expected: FAIL — component not found.

- [ ] **Step 7: Implement the adapter** — `src/lib/components/forms/fields/CreatorFieldAdapter.svelte`:

```svelte
<script>
  import CreatorInput from '$lib/components/educational/CreatorInput.svelte';
  import { manager } from '$lib/stores/accounts.svelte';

  /** Registry-contract adapter around CreatorInput (value = Creator[]). */
  let { field, value = [], error = null, readonly = false, onchange } = $props();

  let creators = $state(Array.isArray(value) ? value : []);
  $effect(() => { creators = Array.isArray(value) ? value : []; });
</script>

<CreatorInput
  bind:creators
  label={field.label}
  required={field.options?.required}
  helpText={field.options?.helpText || ''}
  activeUserPubkey={manager.active?.pubkey || ''}
  onchange={(c) => onchange(c)}
/>
{#if error}<div class="label"><span class="label-text-alt text-error">{error}</span></div>{/if}
```

- [ ] **Step 8: Register in the component registry** — in `src/lib/config/form-field-types.js`:

```js
import CreatorFieldAdapter from '$lib/components/forms/fields/CreatorFieldAdapter.svelte';
export const FIELD_TYPE_REGISTRY = {
  date: DateField,
  creator: CreatorFieldAdapter
};
```

- [ ] **Step 9: Run tests + check**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.creator.test.js src/lib/components/forms/__tests__/CreatorFieldAdapter.test.js` then `pnpm run check`
Expected: PASS, 0 errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/helpers/forms/amb-emitters.js src/lib/components/forms/fields/CreatorFieldAdapter.svelte src/lib/config/form-field-types.js src/lib/__tests__/amb-emitters.creator.test.js src/lib/components/forms/__tests__/
git commit -m "feat(forms): creator field type — NIP-AMB p-tag/creator:* emitter + CreatorInput adapter"
```

---

### Task 3: Relation emitter + RelationFieldAdapter

**Files:**
- Modify: `src/lib/helpers/forms/amb-emitters.js` (add `relationEmitter`, register `amb-relation`)
- Create: `src/lib/components/forms/fields/RelationFieldAdapter.svelte`
- Modify: `src/lib/config/form-field-types.js`
- Test: `src/lib/__tests__/amb-emitters.relation.test.js`; `src/lib/components/forms/__tests__/RelationFieldAdapter.test.js`

**Interfaces:**
- Consumes: Task 1 registry; `AMBPickerRef` shape from `AMBResourceSearchInput.svelte` (`{ coordinate:"30142:pub:d", pubkey, dTag, relayHint?, event }`).
- Produces: `relationEmitter`; type `amb-relation` registered; `value` is an array of `{ coordinate, relayHint?, name? }`.

- [ ] **Step 1: Write failing emitter test** — `src/lib/__tests__/amb-emitters.relation.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

const evt = (tags) => ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('relation emitter (NIP-AMB a-tags)', () => {
  const field = { id: 'parts', type: 'amb-relation', output: 'amb:hasPart', options: {} };
  const ctx = { field, prop: 'hasPart', formDTag: 'amb-basic', defaultLang: 'de' };
  it('emits a-tag per related 30142 coordinate with the AMB role', () => {
    const value = [{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }, { coordinate: '30142:def:res2' }];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([
      ['a', '30142:abc:res1', 'wss://r', 'hasPart'],
      ['a', '30142:def:res2', '', 'hasPart']
    ]);
  });
  it('parses a-tags of the right role back to refs', () => {
    const parsed = resolveEmitter(field).parse(evt([
      ['a', '30142:abc:res1', 'wss://r', 'hasPart'],
      ['a', '30142:def:res2', '', 'isPartOf']
    ]), ctx);
    expect(parsed.value).toEqual([{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.relation.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `relationEmitter`** — append to `amb-emitters.js`:

```js
/** NIP-AMB relation (isPartOf/hasPart/isBasedOn) → a-tag to a 30142 coordinate. */
export const relationEmitter = {
  emit: (value, { prop }) =>
    asArray(value)
      .filter((r) => r?.coordinate)
      .map((r) => ['a', r.coordinate, r.relayHint || '', prop]),
  parse: (event, { prop }) => ({
    value: event.tags
      .filter((t) => t[0] === 'a' && t[3] === prop && t[1]?.startsWith('30142:'))
      .map((t) => ({ coordinate: t[1], relayHint: t[2] || '' }))
  })
};
registerCompositeEmitter('amb-relation', relationEmitter);
```

- [ ] **Step 4: Run the emitter test**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.relation.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing adapter test** — `src/lib/components/forms/__tests__/RelationFieldAdapter.test.js` (jsdom), mocking `AMBResourceSearchInput` to a stub that fires `onselect` with a ref, asserting the adapter appends it and emits the array:

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RelationFieldAdapter from '$lib/components/forms/fields/RelationFieldAdapter.svelte';

vi.mock('$lib/components/educational/AMBResourceSearchInput.svelte', async () => {
  return { default: (await import('./RelationAdapterStub.svelte')).default };
});

describe('RelationFieldAdapter', () => {
  it('appends a picked ref and emits the coordinate list', async () => {
    const onchange = vi.fn();
    render(RelationFieldAdapter, {
      field: { id: 'parts', label: 'Parts', output: 'amb:hasPart', options: {} },
      value: [], error: null, readonly: false, onchange
    });
    // stub fires onselect({coordinate:'30142:abc:res1', relayHint:'wss://r', ...}) on mount
    expect(onchange).toHaveBeenCalledWith([{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }]);
    expect(screen.getByText(/30142:abc:res1/)).toBeTruthy();
  });
});
```

Stub `src/lib/components/forms/__tests__/RelationAdapterStub.svelte`:

```svelte
<script>
  let { onselect } = $props();
  $effect(() => { onselect({ coordinate: '30142:abc:res1', pubkey: 'abc', dTag: 'res1', relayHint: 'wss://r', event: {} }); });
</script>
<div data-testid="relation-stub"></div>
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/lib/components/forms/__tests__/RelationFieldAdapter.test.js`
Expected: FAIL.

- [ ] **Step 7: Implement the adapter** — `src/lib/components/forms/fields/RelationFieldAdapter.svelte` (the adapter OWNS the selected list as the field value, since the picker is add-only):

```svelte
<script>
  import AMBResourceSearchInput from '$lib/components/educational/AMBResourceSearchInput.svelte';
  import { CloseIcon } from '$lib/components/icons';

  /** Registry-contract adapter: value = [{ coordinate, relayHint? }]. */
  let { field, value = [], error = null, readonly = false, onchange } = $props();

  let refs = $state(Array.isArray(value) ? value : []);
  $effect(() => { refs = Array.isArray(value) ? value : []; });

  /** @param {{coordinate:string, relayHint?:string}} ref */
  function add(ref) {
    if (refs.some((r) => r.coordinate === ref.coordinate)) return;
    const next = [...refs, { coordinate: ref.coordinate, relayHint: ref.relayHint || '' }];
    onchange(next);
  }
  function remove(coordinate) {
    onchange(refs.filter((r) => r.coordinate !== coordinate));
  }
</script>

{#if !readonly}
  <AMBResourceSearchInput exclude={refs.map((r) => r.coordinate)} onselect={add} />
{/if}
<div class="mt-2 flex flex-col gap-1">
  {#each refs as r (r.coordinate)}
    <div class="flex items-center gap-2 rounded bg-base-200 px-2 py-1 text-sm">
      <code class="flex-1 truncate">{r.coordinate}</code>
      {#if !readonly}
        <button type="button" class="btn btn-ghost btn-xs" onclick={() => remove(r.coordinate)} aria-label="Remove">
          <CloseIcon class_="w-3 h-3" />
        </button>
      {/if}
    </div>
  {/each}
</div>
{#if error}<div class="label"><span class="label-text-alt text-error">{error}</span></div>{/if}
```

- [ ] **Step 8: Register + run + commit**

Register in `form-field-types.js`: `'amb-relation': RelationFieldAdapter` (import it).

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.relation.test.js src/lib/components/forms/__tests__/RelationFieldAdapter.test.js` then `pnpm run check`
Expected: PASS, 0 errors.

```bash
git add src/lib/helpers/forms/amb-emitters.js src/lib/components/forms/fields/RelationFieldAdapter.svelte src/lib/config/form-field-types.js src/lib/__tests__/amb-emitters.relation.test.js src/lib/components/forms/__tests__/RelationFieldAdapter.test.js src/lib/components/forms/__tests__/RelationAdapterStub.svelte
git commit -m "feat(forms): relation field type — NIP-AMB a-tag emitter + AMBResourceSearchInput adapter"
```

---

### Task 4: External-URLs emitter + ExternalUrlFieldAdapter

**Files:**
- Modify: `src/lib/helpers/forms/amb-emitters.js` (add `rTagEmitter`, register `external-urls`)
- Create: `src/lib/components/forms/fields/ExternalUrlFieldAdapter.svelte`
- Modify: `src/lib/config/form-field-types.js`
- Test: `src/lib/__tests__/amb-emitters.rtag.test.js`; `src/lib/components/forms/__tests__/ExternalUrlFieldAdapter.test.js`

**Interfaces:**
- Consumes: Task 1 registry; `ExternalUrlInput` props (`urls=$bindable(string[])`, `onchange`).
- Produces: `rTagEmitter`; type `external-urls` registered; `value` is `string[]`.

- [ ] **Step 1: Write failing emitter test** — `src/lib/__tests__/amb-emitters.rtag.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';
const field = { id: 'refs', type: 'external-urls', output: 'amb:refs', options: {} };
const ctx = { field, prop: 'refs', formDTag: 'amb-basic', defaultLang: 'de' };
const evt = (tags) => ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('r-tag emitter', () => {
  it('emits r tags and parses them back', () => {
    const em = resolveEmitter(field);
    expect(em.emit(['https://a.example', 'https://doi.org/10.1/x'], ctx)).toEqual([
      ['r', 'https://a.example'],
      ['r', 'https://doi.org/10.1/x']
    ]);
    expect(em.parse(evt([['r', 'https://a.example']]), ctx).value).toEqual(['https://a.example']);
  });
});
```

- [ ] **Step 2: Run to verify it fails / Step 3: Implement** — append to `amb-emitters.js`:

```js
/** External references → Nostr-native r tags (NIP-24). */
export const rTagEmitter = {
  emit: (value) => asArray(value).filter(Boolean).map((u) => ['r', String(u)]),
  parse: (event) => ({ value: event.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]) })
};
registerCompositeEmitter('external-urls', rTagEmitter);
```

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.rtag.test.js` — FAIL then PASS.

- [ ] **Step 4: Adapter test + implement** — `ExternalUrlFieldAdapter.test.js` mirrors the CreatorFieldAdapter test with a stub firing `onchange(['https://a.example'])`. Adapter `src/lib/components/forms/fields/ExternalUrlFieldAdapter.svelte`:

```svelte
<script>
  import ExternalUrlInput from '$lib/components/educational/ExternalUrlInput.svelte';
  let { field, value = [], error = null, readonly = false, onchange } = $props();
  let urls = $state(Array.isArray(value) ? value : []);
  $effect(() => { urls = Array.isArray(value) ? value : []; });
</script>
<ExternalUrlInput bind:urls label={field.label} helpText={field.options?.helpText || ''} onchange={(u) => onchange(u)} />
{#if error}<div class="label"><span class="label-text-alt text-error">{error}</span></div>{/if}
```

(ExternalUrlInput has no readonly prop; wrap the whole thing in `{#if !readonly}...{:else}<read-only chip list>{/if}` — render `urls` as plain text when readonly.)

Register `'external-urls': ExternalUrlFieldAdapter` in `form-field-types.js`.

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run src/lib/__tests__/amb-emitters.rtag.test.js src/lib/components/forms/__tests__/ExternalUrlFieldAdapter.test.js` then `pnpm run check`.

```bash
git add src/lib/helpers/forms/amb-emitters.js src/lib/components/forms/fields/ExternalUrlFieldAdapter.svelte src/lib/config/form-field-types.js src/lib/__tests__/amb-emitters.rtag.test.js src/lib/components/forms/__tests__/ExternalUrlFieldAdapter.test.js
git commit -m "feat(forms): external-urls field type — r-tag emitter + ExternalUrlInput adapter"
```

---

### Task 5: templateNaddr routing + shared TemplateResourceForm + edit

**Files:**
- Modify: `src/lib/config/resource-form-variants.js` (add `templateNaddr` to typedef + `amb` entry from config)
- Modify: `src/lib/stores/config.svelte.js` (surface `resourceFormVariants.templateNaddrs` map, env-driven)
- Create: `src/lib/components/forms/TemplateResourceForm.svelte` (extract the body of `src/routes/forms/[naddr=naddr]/create-resource/+page.svelte`)
- Modify: `src/routes/forms/[naddr=naddr]/create-resource/+page.svelte` (render the shared component)
- Modify: `src/routes/create/resource/[variant=resourceVariant]/+page.svelte` (branch on `templateNaddr`)
- Test: `src/lib/__tests__/resource-form-variants.templateNaddr.test.js`; extend an existing route/component test if present

**Interfaces:**
- Consumes: `parseFormTemplate` (`$lib/helpers/forms.js`), `buildAMBResourceTags`/`parseAMBResourceForForm` (Task 1), `FormRenderer`, `getVariantById`.
- Produces: `getVariantById(id)?.templateNaddr` (string | undefined); `TemplateResourceForm` component with props `{ templateNaddr, communityPubkey?, editNaddr? }`.

- [ ] **Step 1: Write failing variant test** — `src/lib/__tests__/resource-form-variants.templateNaddr.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('variant templateNaddr', () => {
  beforeEach(() => vi.resetModules());
  it('reads templateNaddr for a variant from runtime config', async () => {
    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: { resourceFormVariants: { enabled: ['amb'], templateNaddrs: { amb: 'naddr1abc' } } },
      configReady: { subscribe: () => () => {} }
    }));
    const { getVariantById } = await import('$lib/config/resource-form-variants.js');
    expect(getVariantById('amb')?.templateNaddr).toBe('naddr1abc');
  });
  it('templateNaddr is undefined when unset', async () => {
    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: { resourceFormVariants: { enabled: ['amb'] } },
      configReady: { subscribe: () => () => {} }
    }));
    const { getVariantById } = await import('$lib/config/resource-form-variants.js');
    expect(getVariantById('amb')?.templateNaddr).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/resource-form-variants.templateNaddr.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement templateNaddr plumbing**

In `resource-form-variants.js`: add `@property {string} [templateNaddr]` to the `ResourceFormVariant` typedef, and in `getEnabledVariants()`/`getVariantById()` decorate each returned variant with `templateNaddr: runtimeConfig.resourceFormVariants?.templateNaddrs?.[v.id]`. Keep `ALL_VARIANTS` static (no naddr baked in — it's deployment config).

In `config.svelte.js`: ensure `/api/config`'s `resourceFormVariants` shape includes `templateNaddrs` (a `{ [variantId]: naddr }` map sourced from env like `RESOURCE_FORM_TEMPLATE_NADDR_AMB`). Mirror how `schemeNaddrs` is surfaced (config.svelte.js already has that pattern). Add the env read in the server `/api/config` handler and the `templateNaddrs` field in the client store default (`{}`).

Run: `pnpm vitest run src/lib/__tests__/resource-form-variants.templateNaddr.test.js`
Expected: PASS.

- [ ] **Step 4: Extract `TemplateResourceForm.svelte`**

Move the script + template of `src/routes/forms/[naddr=naddr]/create-resource/+page.svelte` into `src/lib/components/forms/TemplateResourceForm.svelte` with props `{ templateNaddr, communityPubkey = '', editNaddr = '' }`. It: decodes `templateNaddr` (via `decodeFormNaddr`), loads the 30168 (addressLoader + eventStore.replaceable), parses it, on submit builds the 30142 via `buildAMBResourceTags` — **lifting the `['content', …]` pseudo-tag into the event content and removing it from tags** — signs, publishes (`publishEvent`), navigates to the resource. Edit mode via `editNaddr` reuses the existing `parseAMBResourceForForm` prefill. Then the original route becomes:

```svelte
<script>
  import TemplateResourceForm from '$lib/components/forms/TemplateResourceForm.svelte';
  import { page } from '$app/stores';
  let { data } = $props();
  const editNaddr = $derived($page.url.searchParams.get('edit') || '');
</script>
<TemplateResourceForm templateNaddr={data.naddr} {editNaddr} />
```

Concretely for the content lift in `TemplateResourceForm`'s submit:

```js
const built = buildAMBResourceTags({ form: { pubkey, dTag: identifier, fields }, formRelay, values: rawValues, selectedConcepts });
const contentTag = built.find((t) => t[0] === 'content');
const tags = [['d', dTag], ...built.filter((t) => t[0] !== 'content' && t[0] !== 'd')];
const content = contentTag?.[1] || rawValues.description || '';
```

- [ ] **Step 5: Branch the variant route**

In `src/routes/create/resource/[variant=resourceVariant]/+page.svelte`, after `isResolvingVariant` resolves, compute `const templateNaddr = $derived(getVariantById(data.variantId)?.templateNaddr)`. In the content block:

```svelte
{:else if templateNaddr}
  <TemplateResourceForm {templateNaddr} communityPubkey={data.communityPubkey} editNaddr={data.editNaddr} />
{:else}
  <ResourceFormWizard communityPubkey={data.communityPubkey} {editEvent} {editResource} variantId={data.variantId} />
{/if}
```

(Import `TemplateResourceForm` and `getVariantById`. When `templateNaddr` is set, skip the wizard's edit-event fetch — the shared component handles edit via `editNaddr`.)

- [ ] **Step 6: Verify + commit**

Run: `pnpm vitest run src/lib/__tests__/resource-form-variants.templateNaddr.test.js` and `pnpm run check` and `pnpm run lint`.
Expected: PASS, 0 errors, clean.

```bash
git add src/lib/config/resource-form-variants.js src/lib/stores/config.svelte.js src/lib/components/forms/TemplateResourceForm.svelte src/routes/forms/ src/routes/create/resource/ src/lib/__tests__/resource-form-variants.templateNaddr.test.js
git commit -m "feat(forms): templateNaddr variant routing + shared TemplateResourceForm"
```

---

### Task 6: Publish the amb-basic 30168 template

**Files:**
- Modify: `scripts/data/edufeed-forms.json` (add the `amb-basic` form entry)
- Modify: `scripts/lib/publish-forms-build.mjs` (ensure `sections` + `field-output` + `field-vocab` all serialize; add if missing)
- Test: `scripts/lib/__tests__/publish-forms-build.amb.test.mjs` (new)

**Interfaces:**
- Consumes: `buildFormTemplate` (`scripts/lib/publish-forms-build.mjs`), `buildFormTemplateTags`/`parseFormTemplate` (`src/lib/helpers/forms/format.js`), the field types from Tasks 2-4.
- Produces: a published-able `amb-basic` 30168 template whose fields carry `field-output` (`amb:name`, `amb:description`, `amb:about`, …) and `field-vocab` bindings; parseable round-trip.

- [ ] **Step 1: Inspect current `buildFormTemplate` support** — read `scripts/lib/publish-forms-build.mjs`. Confirm `toFormField` maps JSON `output`/`vocabRef` to `field.output`/`field.vocab`, and that `buildFormTemplate` passes `sections` to `buildFormTemplateTags`. If `sections` is not passed through, add it (`buildFormTemplateTags(dTag, fields, { name, description, sections: form.sections })`).

- [ ] **Step 2: Write the failing test** — `scripts/lib/__tests__/publish-forms-build.amb.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFormTemplate } from '../publish-forms-build.mjs';
import { parseFormTemplate } from '../../../src/lib/helpers/forms/format.js';

const forms = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/edufeed-forms.json', import.meta.url)), 'utf8')).forms;
const amb = forms.find((f) => f.d === 'amb-basic');

describe('amb-basic template', () => {
  it('exists in the data file', () => {
    expect(amb).toBeTruthy();
  });
  it('builds NIP-101 tags and round-trips with AMB field-output bindings', () => {
    // env stub for any SCHEME_NADDR_* vocab refs the form uses
    process.env.SCHEME_NADDR_SCHULFAECHER ||= 'naddr1qqx...'; // placeholder decodes handled in build
    const tags = buildFormTemplate(amb);
    expect(tags.some((t) => t[0] === 'settings')).toBe(true);
    const parsed = parseFormTemplate({ kind: 30168, pubkey: 'pk', content: '', created_at: 0, tags });
    // title field maps to amb:name
    const nameField = parsed.fields.find((f) => f.output === 'amb:name');
    expect(nameField).toBeTruthy();
    // a concept field carries a field-vocab binding
    expect(parsed.fields.some((f) => f.vocab?.address)).toBe(true);
    // a creator field is present with the creator renderElement
    expect(parsed.fields.some((f) => f.type === 'creator')).toBe(true);
  });
});
```

(If the form references vocab schemes via env naddrs, mirror the env-stubbing approach already used in `publish-forms-build.test.mjs`. If `buildFormTemplate` throws on an undecodable placeholder naddr, use a real-shaped test naddr as in the existing test.)

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run scripts/lib/__tests__/publish-forms-build.amb.test.mjs`
Expected: FAIL — no `amb-basic` entry.

- [ ] **Step 4: Add the `amb-basic` entry to `edufeed-forms.json`**

Add a form with `d: "amb-basic"`, a `name`, `description`, optional `sections` (Basic / Classification / Content / Relations), and `fields` covering the slice-1 set. Each field: `{ id, type, label, required?, output, vocabRef? }`. Concrete fields (map `type` to the registered renderElements and `output` to AMB props):

```json
{
  "d": "amb-basic",
  "name": "Lernressource teilen",
  "description": "AMB-Metadaten für eine Bildungsressource",
  "fields": [
    { "id": "title", "type": "text", "label": "Titel", "required": true, "output": "amb:name" },
    { "id": "description", "type": "textarea", "label": "Beschreibung", "output": "amb:description" },
    { "id": "url", "type": "url", "label": "URL / Identifier", "output": "amb:id" },
    { "id": "language", "type": "text", "label": "Sprache", "output": "amb:inLanguage" },
    { "id": "datePublished", "type": "date", "label": "Veröffentlicht am", "output": "amb:datePublished" },
    { "id": "image", "type": "url", "label": "Vorschaubild-URL", "output": "amb:image" },
    { "id": "license", "type": "select", "label": "Lizenz", "output": "amb:license" },
    { "id": "isAccessibleForFree", "type": "checkbox", "label": "Frei zugänglich", "output": "amb:isAccessibleForFree" },
    { "id": "about", "type": "select", "label": "Fach", "output": "amb:about", "vocabRef": "schulfaecher" },
    { "id": "learningResourceType", "type": "select", "label": "Materialtyp", "output": "amb:learningResourceType", "vocabRef": "newLrt" },
    { "id": "educationalLevel", "type": "select", "label": "Bildungsstufe", "output": "amb:educationalLevel", "vocabRef": "educationalLevel" },
    { "id": "keywords", "type": "text-array", "label": "Schlagwörter", "output": "amb:keywords" },
    { "id": "creators", "type": "creator", "label": "Urheber:innen", "output": "amb:creator" },
    { "id": "externalUrls", "type": "external-urls", "label": "Weitere Quellen", "output": "amb:refs" },
    { "id": "hasPart", "type": "amb-relation", "label": "Enthält (hasPart)", "output": "amb:hasPart" },
    { "id": "isPartOf", "type": "amb-relation", "label": "Teil von (isPartOf)", "output": "amb:isPartOf" }
  ]
}
```

Match `vocabRef` values (`schulfaecher`/`newLrt`/`educationalLevel`) to the keys `publish-forms-build.mjs` already resolves via `SCHEME_NADDR_*` env (check `vocabEnvName`). Adjust the exact `select` type / `field.vocab` handling so `toFormField` produces the `field.vocab` binding (existing membership vocab forms show the pattern).

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run scripts/lib/__tests__/publish-forms-build.amb.test.mjs`
Expected: PASS. Then `pnpm run check`.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/edufeed-forms.json scripts/lib/publish-forms-build.mjs scripts/lib/__tests__/publish-forms-build.amb.test.mjs
git commit -m "feat(scripts): publishable amb-basic 30168 template with AMB field-output bindings"
```

---

### Task 7: NIP-101-EDU doc correction + full verification + E2E

**Files:**
- Modify: `docs/nips/nip-101-edu.md`
- Create: `e2e/amb-basic-form.spec.js`; modify `e2e/COVERAGE.md`
- Test: full targeted suite + check + lint

**Interfaces:** none new; documents Tasks 1-6.

- [ ] **Step 1: Correct the NIP-101-EDU doc**

In `docs/nips/nip-101-edu.md`, `field-output` section: replace any text/example showing a concept `["a","39738:…",role]` tag with the NIP-AMB concept shape (`:id` external URI, `:prefLabel:<lang>` per language, `:type "Concept"`, **no a-tag**). Correct the ext example to `ext:<form-d-tag>:<facet>:<sub>` (colon-free namespace = the form's d-tag). Add a sentence citing **NIP-AMB** as the authoritative kind-30142 emission grammar and note relations/creators/keywords emit per NIP-AMB (`a`-tag relations, `p`/`creator:*`, `t`).

- [ ] **Step 2: Commit the doc (force-add)**

```bash
git add -f docs/nips/nip-101-edu.md
git commit -m "docs(nip-101-edu): align field-output with NIP-AMB (concepts no a-tag, ext form-d-tag namespace)"
```

- [ ] **Step 3: Write the E2E** — `e2e/amb-basic-form.spec.js` following the patterns in existing `e2e/` specs. It should: configure/seed a `templateNaddr` for `amb` (or navigate directly to `/forms/<amb-basic-naddr>/create-resource` if seeding variant config is impractical in E2E — pick whichever the existing harness supports, documented in `e2e/COVERAGE.md`), fill title + description + a keyword + (if a signer is stubbed) submit, and assert the resulting 30142 tag shape via the app's network/console or a post-publish read. If full publish needs a live signer/relay the E2E can't provide, scope the E2E to: render the template form, fill fields, and assert the built tag preview (expose a testable build step) — document the limitation in COVERAGE.md rather than faking a pass.

- [ ] **Step 4: Update `e2e/COVERAGE.md`** — add a row for the amb-basic template form flow, noting what's covered and any signer/relay limitation.

- [ ] **Step 5: Full verification**

Run, in order:
1. `pnpm vitest run src/lib/__tests__/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/ scripts/lib/__tests__/` — Expected: PASS.
2. `pnpm run check` — 0 errors.
3. `pnpm run lint` — clean.
4. `pnpm test` (full suite, once, not while the user is browser-testing) — PASS modulo the documented pre-existing flaky inbox/DM + GlobalFAB teardown races; anything else failing must be fixed.

- [ ] **Step 6: Commit**

```bash
git add e2e/amb-basic-form.spec.js e2e/COVERAGE.md
git commit -m "test(e2e): amb-basic template form flow + coverage"
```

---

## Out of scope (later slices, same branch)

Image+license (1063/`x`-tag), curriculum picker, files, EKW/Konfi ext facets, `cover_color`, `suggestedAge`/media/`publisher`/`funder`/`contributor`, enrichment prefill, draft store, community share, wizard-fidelity edit (Bildungsbereich inference, creator-reattach), converter (`amb-nostr-converter`) convergence to NIP-AMB, wizard retirement per variant, and the emitter-registry/form-engine library extraction ([[form-builder-extraction-decision]]).

## Self-review notes

- **Spec coverage:** field set (Task 6 template + Tasks 1-4 emitters/adapters); emitter-registry split (Task 1); compliance fixes — concept a-tag drop + multi-lang + ext namespace (Task 1), doc (Task 7); templateNaddr routing + shared component + edit (Task 5); testing incl. NIP-AMB golden fixtures (every emitter task) and E2E (Task 7). All spec sections mapped.
- **Registry drift mitigation:** Task 6's round-trip test + the E2E exercise every registered field type through both registries; a foreign/unknown type still falls back to text (Phase-1a behavior, unchanged).
- **Type consistency:** `resolveEmitter`/`fieldProp`/`registerCompositeEmitter`/`COMPOSITE_EMITTERS` and the `AmbEmitter` `{emit,parse}` shape are used identically across Tasks 1-4; `TemplateResourceForm` props `{templateNaddr, communityPubkey, editNaddr}` match its consumers in Task 5.
