# NIP-101 Forms Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the app's kind-30168/1069 forms engine with the NIP-101 draft wire format, add sections + branching (`displayIf`, section routing), and lay the field-type-registry foundation — so metadata form templates can express the wizard's step/path structure.

**Architecture:** Evolve System A in place. The public helper API (`buildFormTemplateTags` / `parseFormTemplate` / `FormField` shape) stays stable while the tag encoding underneath switches to NIP-101 positions; a legacy sniff reads the old dialect until the membership templates are re-published. Branching logic is pure functions in a new `forms/` module folder; `FormRenderer` gains a sections wizard mode; `FieldsRenderer` consults a field-type registry with text-input fallback.

**Tech Stack:** SvelteKit + Svelte 5 runes, JSDoc types, Vitest (node + jsdom projects), applesauce (EventFactory), nostr-tools `nip19` only (never for relay comm).

**Spec:** `docs/superpowers/specs/2026-07-18-nostr-metadata-forms-design.md` (Sections 1, 2, 5, 6). The template-driven AMB resource route (spec Section 3) is a **separate follow-up plan** — do not build it here.

**Module-layout deviation from the spec (deliberate):** the spec sketches `forms/{format,legacy,validate,branching}.js`. This plan puts the legacy parser inside `format.js` (it is one private function, and encoding+decoding belong together) and leaves `validateField` in `forms.js` (unchanged code; moving it is churn without benefit). `branching.js` and `crypto.js` are separate as specced. If `format.js` outgrows ~400 lines in the follow-up plan, split legacy out then.

## Global Constraints

- Work in a **git worktree**, not the main checkout (`superpowers:using-git-worktrees`). New worktrees base on `main` — rebase onto `dev` before starting. Copy `.env` from the main checkout into the worktree.
- Package manager is **pnpm**. Unit tests: `pnpm vitest run <file>` (node env needs `/** @vitest-environment node */`, component tests `jsdom`).
- Never use nostr-tools for relay communication; `nip19` encoding/decoding is fine.
- `docs/` is gitignored — any file added under `docs/` needs `git add -f`.
- In Paraglide message values, never put `@` directly before a `{param}` placeholder (breaks svelte-check in the pre-push hook); put the `@` inside the param value instead.
- The pre-push hook runs in the **main checkout**; if this branch changes dependencies (it should not), run `pnpm install` there before pushing.
- Avoid running the full `pnpm test` suite while the user is browser-testing on the dev server (Paraglide HMR storm). Full-suite runs also have known-flaky inbox/DM tests when run in parallel — prefer the targeted commands given in each task; run the full suite only in the final task.
- All keyed `{#each}` blocks over tag-derived data must be deduped (`$lib/helpers/unique.js`) — relevant when rendering parsed options.
- Existing kind-30168 events in the wild (our old dialect, Formstr's encrypted forms, the "lotus" JSON dialect) must never crash the parser — malformed input yields empty/default values, not exceptions.

---

## New wire format (normative for this plan)

Written by `buildFormTemplateTags`, read by `parseFormTemplate`. This is the NIP-101 base layer plus our extension tags.

```
["d", "<dTag>"]
["name", "<name>"]                                  // if non-empty
["settings", "<JSON>"]                              // ALWAYS present — this tag marks the new format
["a", "30168:<pk>:<d>", "<relay>", "forkOf"]        // extension: fork provenance (if forked)
// per field:
["field", "<id>", "<inputType>", "<label>", "<optionsJSON>", "<fieldSettingsJSON>"]
["field-vocab", "<id>", "a", "39737:<pk>:<d>", "<relay>"]   // extension: SKOS scheme binding
["field-output", "<id>", "amb:<prop>" | "ext"]              // extension: output mapping
```

- **`settings` JSON:** `{ description?, publicForm?, confirmationMessage?, autoResponse?, sections? }` — keys omitted when empty/false. `sections` is `[{ id, title, description?, questionIds: string[], order? }]` (Formstr's merged shape).
- **`inputType`:** `"option"` iff `field.type` is `select` or `radio` AND the field has no vocab binding; otherwise `"text"`.
- **`optionsJSON`:** for option fields, `JSON.stringify` of `[optionId, label]` pairs — or `[optionId, label, configJSON]` triples where `configJSON` is a stringified object like `{"nextSection":"<sectionId>"}`. `"[]"` for non-option fields.
- **`fieldSettingsJSON`:** the old per-field options object minus its `options` array, plus `renderElement` (our rich type string), `defaultValue` (if set), and optionally `displayIf` (`{ rules: ConditionGroup[] }`, see Task 2).
- **Responses (kind 1069):** `["response", fieldId, value, "{}"]` (4th element = metadata JSON, `"{}"` for now). Option-field values are **optionIds**, multi-select joined with `";"`. Encrypted responses: the JSON-stringified response-tag array goes in `content`, NIP-44 responder→form-author, plus an `["encrypted"]` marker tag.

**Legacy detection:** a 30168 event **without** a `settings` tag parses via the legacy path (old positions: t[4]=defaultValue, t[5]=options-object JSON; `description`/`public`/`confirmation_message`/`auto_response` as discrete tags). Legacy option strings become `{ id: <label>, label: <label> }` so old label-valued responses still resolve.

**Parsed `FormField` shape (public API, consumed by all components):**

```js
/**
 * @typedef {Object} FormFieldOption
 * @property {string} id
 * @property {string} label
 * @property {string} [nextSection]
 *
 * @typedef {Object} FormField
 * @property {string} id
 * @property {string} type            // rich type: text|textarea|text-array|number|email|url|select|checkbox|radio|date
 * @property {string} label
 * @property {string} [defaultValue]
 * @property {Record<string, any>} options  // { required?, placeholder?, min?, max?, multiple?, allowCustom?, customLabel?, customButtonLabel?, customPlaceholder?, displayIf?, options?: FormFieldOption[] }
 * @property {{ address: string, relay: string }} [vocab]
 * @property {string} [output]
 *
 * @typedef {Object} FormSection
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string[]} questionIds
 * @property {number} [order]
 */
```

`ParsedFormTemplate` gains `sections: FormSection[]` (empty array when none). **The only breaking change for consumers is `options.options`: `string[]` → `FormFieldOption[]`.** Known consumers (all updated in Task 3): `FieldsRenderer.svelte:133,167,173`, `FormBuilder.svelte:100,229`.

---

### Task 1: NIP-101 encoding in `forms/format.js`

**Files:**
- Create: `src/lib/helpers/forms/format.js`
- Modify: `src/lib/helpers/forms.js` (delegate; remove moved code)
- Test: `src/lib/__tests__/forms.format.test.js` (new)
- Modify: `src/lib/__tests__/forms.test.js`, `src/lib/__tests__/forms.extensions.test.js` (expectations move to new encoding)

**Interfaces:**
- Produces: `buildFormTemplateTags(dTag, fields, options)` — `options` gains `sections?: FormSection[]`; `parseFormTemplate(event)` → `ParsedFormTemplate` with `sections`; `generateOptionId(label, existingIds)` → string. All re-exported from `$lib/helpers/forms.js` so no import site changes.
- Consumes: nothing new.

- [ ] **Step 1: Baseline** — run existing forms unit tests, confirm green before touching anything:

Run: `pnpm vitest run src/lib/__tests__/forms.test.js src/lib/__tests__/forms.extensions.test.js`
Expected: PASS.

- [ ] **Step 2: Write the failing test** — create `src/lib/__tests__/forms.format.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildFormTemplateTags,
  parseFormTemplate,
  generateOptionId
} from '$lib/helpers/forms/format.js';

const evt = (tags, content = '') => ({ kind: 30168, pubkey: 'pk', tags, content, created_at: 0 });

describe('NIP-101 encoding', () => {
  it('emits NIP-101 field-tag positions and a settings tag', () => {
    const tags = buildFormTemplateTags(
      'my-form',
      [
        {
          id: 'age',
          type: 'number',
          label: 'Your age?',
          defaultValue: '18',
          options: { required: true, min: 0 }
        },
        {
          id: 'color',
          type: 'radio',
          label: 'Favourite colour?',
          options: {
            required: true,
            options: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue', nextSection: 'sec-blue' }
            ]
          }
        }
      ],
      { name: 'Test', description: 'Desc', public: true, sections: [] }
    );

    const settingsTag = tags.find((t) => t[0] === 'settings');
    expect(JSON.parse(settingsTag[1])).toEqual({ description: 'Desc', publicForm: true });
    // no legacy discrete tags
    expect(tags.some((t) => t[0] === 'description')).toBe(false);
    expect(tags.some((t) => t[0] === 'public')).toBe(false);

    const age = tags.find((t) => t[0] === 'field' && t[1] === 'age');
    expect(age[2]).toBe('text'); // NIP-101 primitive
    expect(age[3]).toBe('Your age?');
    expect(JSON.parse(age[4])).toEqual([]); // options JSON at position 4
    expect(JSON.parse(age[5])).toEqual({
      renderElement: 'number',
      required: true,
      min: 0,
      defaultValue: '18'
    });

    const color = tags.find((t) => t[0] === 'field' && t[1] === 'color');
    expect(color[2]).toBe('option');
    const triples = JSON.parse(color[4]);
    expect(triples[0]).toEqual(['red', 'Red']);
    expect(triples[1][0]).toBe('blue');
    expect(JSON.parse(triples[1][2])).toEqual({ nextSection: 'sec-blue' });
  });

  it('round-trips through parseFormTemplate', () => {
    const fields = [
      {
        id: 'topic',
        type: 'select',
        label: 'Topic',
        defaultValue: '',
        options: {
          multiple: true,
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' }
          ]
        }
      }
    ];
    const sections = [{ id: 's1', title: 'Step 1', questionIds: ['topic'] }];
    const tags = buildFormTemplateTags('rt', fields, { name: 'RT', sections });
    const parsed = parseFormTemplate(evt(tags));
    expect(parsed.name).toBe('RT');
    expect(parsed.sections).toEqual(sections);
    expect(parsed.fields[0].type).toBe('select');
    expect(parsed.fields[0].options.multiple).toBe(true);
    expect(parsed.fields[0].options.options).toEqual([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]);
  });

  it('keeps extension tags (vocab, output, forkOf) unchanged', () => {
    const tags = buildFormTemplateTags(
      'x',
      [
        {
          id: 'lrt',
          type: 'select',
          label: 'Type',
          options: {},
          vocab: { address: '39737:pk:hcrt', relay: 'wss://r' },
          output: 'amb:learningResourceType'
        }
      ],
      { forkOf: { address: '30168:pk2:orig', relay: 'wss://r2' } }
    );
    expect(tags).toContainEqual(['field-vocab', 'lrt', 'a', '39737:pk:hcrt', 'wss://r']);
    expect(tags).toContainEqual(['field-output', 'lrt', 'amb:learningResourceType']);
    expect(tags).toContainEqual(['a', '30168:pk2:orig', 'wss://r2', 'forkOf']);
    // vocab-bound choice field is NOT inputType option (options come from vocab)
    expect(tags.find((t) => t[0] === 'field')[2]).toBe('text');
  });

  it('parses the legacy dialect (no settings tag) including option strings', () => {
    const legacy = evt([
      ['d', 'old'],
      ['name', 'Old form'],
      ['description', 'Old desc'],
      ['public'],
      ['field', 'role', 'radio', 'Role?', 'Teacher', '{"required":true,"options":["Teacher","Student"]}']
    ]);
    const parsed = parseFormTemplate(legacy);
    expect(parsed.description).toBe('Old desc');
    expect(parsed.isPublic).toBe(true);
    expect(parsed.sections).toEqual([]);
    const f = parsed.fields[0];
    expect(f.type).toBe('radio');
    expect(f.defaultValue).toBe('Teacher');
    expect(f.options.required).toBe(true);
    expect(f.options.options).toEqual([
      { id: 'Teacher', label: 'Teacher' },
      { id: 'Student', label: 'Student' }
    ]);
  });

  it('never throws on foreign/garbage events', () => {
    // Formstr encrypted template: only d/name/relay tags, ciphertext content
    const encrypted = evt([['d', 'cezpPW'], ['name', 'Event RSVP'], ['relay', 'wss://relay.damus.io/']], 'Ao1zaZrLE5…');
    expect(parseFormTemplate(encrypted).fields).toEqual([]);
    // lotus dialect: JSON content, no settings/field tags
    const lotus = evt([['d', 'form-1'], ['title', 'Untitled form'], ['t', 'nostroogle-form'], ['client', 'lotus']], '{"questions":[]}');
    expect(parseFormTemplate(lotus).fields).toEqual([]);
    // malformed field tag JSON
    const broken = evt([['d', 'b'], ['settings', 'not-json'], ['field', 'x', 'text', 'X', 'not-json', 'not-json']]);
    const p = parseFormTemplate(broken);
    expect(p.fields[0].id).toBe('x');
    expect(p.fields[0].options).toEqual({});
  });

  it('generateOptionId slugifies and dedupes', () => {
    expect(generateOptionId('Red Colour!', [])).toBe('red-colour');
    expect(generateOptionId('Red Colour!', ['red-colour'])).toBe('red-colour-2');
    // empty slug falls back exactly like generateFieldId ('field-1' behavior)
    expect(generateOptionId('äöü', [])).toBe('option-1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/forms.format.test.js`
Expected: FAIL — cannot resolve `$lib/helpers/forms/format.js`.

- [ ] **Step 4: Implement `src/lib/helpers/forms/format.js`**

Move `FORM_TEMPLATE_KIND`, the `FormField`/`ParsedFormTemplate` typedefs, `buildFormTemplateTags`, `parseFormTemplate`, and `generateFieldId` here from `forms.js` (delete them there), then rewrite build/parse:

```js
import { unique } from '$lib/helpers/unique.js';

/** Kind for form template events */
export const FORM_TEMPLATE_KIND = 30168;
/** Kind for form response events */
export const FORM_RESPONSE_KIND = 1069;

// … FormField / FormFieldOption / FormSection / ParsedFormTemplate typedefs
//   exactly as in the plan preamble …

/** Shared slugifier for field and option ids. */
function slugId(label, existingIds, fallbackBase) {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const isFallback = !base;
  if (!base) base = fallbackBase;
  if (!isFallback && !existingIds.includes(base)) return base;
  let suffix = isFallback ? 1 : 2;
  while (existingIds.includes(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * Generate a unique field ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 */
export function generateFieldId(label, existingIds) {
  return slugId(label, existingIds, 'field');
}

/**
 * Generate a unique option ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 */
export function generateOptionId(label, existingIds) {
  return slugId(label, existingIds, 'option');
}

/**
 * Build tags for a form template event (kind 30168) — NIP-101 base encoding
 * plus edufeed extension tags (field-vocab / field-output / forkOf).
 * @param {string} dTag
 * @param {FormField[]} fields
 * @param {{ name?: string, description?: string, public?: boolean, confirmationMessage?: string, autoResponse?: boolean, forkOf?: { address: string, relay: string }, sections?: FormSection[] }} options
 * @returns {string[][]}
 */
export function buildFormTemplateTags(dTag, fields, options = {}) {
  /** @type {string[][]} */
  const tags = [['d', dTag]];
  if (options.name) tags.push(['name', options.name]);

  /** @type {Record<string, any>} */
  const settings = {};
  if (options.description) settings.description = options.description;
  if (options.public) settings.publicForm = true;
  if (options.confirmationMessage) settings.confirmationMessage = options.confirmationMessage;
  if (options.autoResponse) settings.autoResponse = true;
  if (options.sections?.length) settings.sections = options.sections;
  tags.push(['settings', JSON.stringify(settings)]);

  if (options.forkOf?.address) {
    tags.push(['a', options.forkOf.address, options.forkOf.relay || '', 'forkOf']);
  }

  for (const field of fields) {
    const { options: choiceOptions, ...fieldSettings } = field.options || {};
    const isOptionType = (field.type === 'select' || field.type === 'radio') && !field.vocab;
    const optionEntries = isOptionType
      ? (choiceOptions || []).map((o) =>
          o.nextSection
            ? [o.id, o.label, JSON.stringify({ nextSection: o.nextSection })]
            : [o.id, o.label]
        )
      : [];
    /** @type {Record<string, any>} */
    const fs = { renderElement: field.type, ...fieldSettings };
    if (field.defaultValue) fs.defaultValue = field.defaultValue;

    tags.push([
      'field',
      field.id,
      isOptionType ? 'option' : 'text',
      field.label,
      JSON.stringify(optionEntries),
      JSON.stringify(fs)
    ]);
    if (field.vocab) tags.push(['field-vocab', field.id, 'a', field.vocab.address, field.vocab.relay]);
    if (field.output) tags.push(['field-output', field.id, field.output]);
  }

  return tags;
}

/** @param {string} raw @returns {any} */
function safeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a form template event. Detects the encoding: events with a `settings`
 * tag use the NIP-101 layout; everything else falls back to the legacy
 * edufeed dialect (pre-2026-07). Never throws on foreign/garbage events.
 * @param {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number }} event
 * @returns {ParsedFormTemplate}
 */
export function parseFormTemplate(event) {
  const tags = event.tags || [];
  const settingsTag = tags.find((t) => t[0] === 'settings');
  if (!settingsTag) return parseLegacyFormTemplate(event);

  const settings = safeJson(settingsTag[1]) || {};
  const dTag = tags.find((t) => t[0] === 'd')?.[1] || '';
  const name = tags.find((t) => t[0] === 'name')?.[1] || '';

  /** @type {FormField[]} */
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      const rawOptions = safeJson(t[4]);
      const fs = safeJson(t[5]) || {};
      const { renderElement, defaultValue, ...rest } = fs;
      /** @type {Record<string, any>} */
      const opts = { ...rest };
      if (Array.isArray(rawOptions) && rawOptions.length > 0) {
        opts.options = rawOptions
          .filter((o) => Array.isArray(o) && o[0] !== undefined)
          .map((o) => {
            /** @type {FormFieldOption} */
            const entry = { id: String(o[0]), label: String(o[1] ?? o[0]) };
            const cfg = typeof o[2] === 'string' ? safeJson(o[2]) : o[2];
            if (cfg?.nextSection) entry.nextSection = String(cfg.nextSection);
            return entry;
          });
      }
      return {
        id: t[1],
        type: renderElement || (t[2] === 'option' ? 'select' : 'text'),
        label: t[3],
        defaultValue: defaultValue || '',
        options: opts
      };
    });

  attachExtensions(fields, tags);

  const forkTag = tags.find((t) => t[0] === 'a' && t[3] === 'forkOf' && t[1]?.startsWith('30168:'));
  return {
    dTag,
    name,
    description: settings.description || '',
    fields,
    isPublic: !!settings.publicForm,
    confirmationMessage: settings.confirmationMessage || '',
    autoResponse: !!settings.autoResponse,
    sections: Array.isArray(settings.sections) ? settings.sections : [],
    forkOf: forkTag ? { address: forkTag[1], relay: forkTag[2] || '' } : undefined
  };
}

/** Attach field-vocab / field-output extension tags to parsed fields. */
function attachExtensions(fields, tags) {
  for (const field of fields) {
    const vt = tags.find((t) => t[0] === 'field-vocab' && t[1] === field.id && t[2] === 'a');
    if (vt) field.vocab = { address: vt[3], relay: vt[4] || '' };
    const ot = tags.find((t) => t[0] === 'field-output' && t[1] === field.id);
    field.output = ot?.[2] || `amb:${field.id}`;
  }
}

/**
 * Legacy dialect parser (pre-NIP-101): field tag positions
 * [field, id, type, label, defaultValue, optionsObjectJSON], discrete
 * description/public/confirmation_message/auto_response tags. Option strings
 * become {id: label, label} so old label-valued responses still resolve.
 * @param {{ tags: string[][] }} event
 * @returns {ParsedFormTemplate}
 */
function parseLegacyFormTemplate(event) {
  const tags = event.tags || [];
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      const opts = safeJson(t[5]) || {};
      if (Array.isArray(opts.options)) {
        opts.options = unique(opts.options.map(String)).map((s) => ({ id: s, label: s }));
      }
      return { id: t[1], type: t[2], label: t[3], defaultValue: t[4] || '', options: opts };
    });

  attachExtensions(fields, tags);

  const forkTag = tags.find((t) => t[0] === 'a' && t[3] === 'forkOf' && t[1]?.startsWith('30168:'));
  return {
    dTag: tags.find((t) => t[0] === 'd')?.[1] || '',
    name: tags.find((t) => t[0] === 'name')?.[1] || '',
    description: tags.find((t) => t[0] === 'description')?.[1] || '',
    fields,
    isPublic: tags.some((t) => t[0] === 'public'),
    confirmationMessage: tags.find((t) => t[0] === 'confirmation_message')?.[1] || '',
    autoResponse: tags.find((t) => t[0] === 'auto_response')?.[1] === 'true',
    sections: [],
    forkOf: forkTag ? { address: forkTag[1], relay: forkTag[2] || '' } : undefined
  };
}
```

Note: `slugId`'s fallback branch must reproduce `generateFieldId`'s current behavior exactly (empty slug → `field-1`, `field-2`, …). Keep the existing `generateFieldId` unit expectations green — if `forms.test.js` disagrees with the refactor, the refactor is wrong, not the test.

- [ ] **Step 5: Delegate from `forms.js`**

In `src/lib/helpers/forms.js`: delete the moved code (typedefs, `FORM_TEMPLATE_KIND`, `buildFormTemplateTags`, `parseFormTemplate`, `generateFieldId`, and the now-internal legacy logic) and add at the top:

```js
export {
  FORM_TEMPLATE_KIND,
  FORM_RESPONSE_KIND,
  buildFormTemplateTags,
  parseFormTemplate,
  generateFieldId,
  generateOptionId
} from './forms/format.js';
```

Replace the hardcoded `1069` in `buildUserResponseFilter` with `FORM_RESPONSE_KIND` (import it). Everything else in `forms.js` (naddr helpers, membership form definitions, request helpers, `findLinkedProfileLists`, `validateField`, `buildResponseTags`, `parseResponseTags`) stays for now.

- [ ] **Step 6: Run the new tests**

Run: `pnpm vitest run src/lib/__tests__/forms.format.test.js`
Expected: PASS.

- [ ] **Step 7: Update legacy-encoding expectations in existing tests**

Run: `pnpm vitest run src/lib/__tests__/forms.test.js src/lib/__tests__/forms.extensions.test.js src/lib/__tests__/edufeedMembershipForm.test.js src/lib/__tests__/communityFormDefaults.test.js`

Tests that assert the OLD tag layout (defaultValue at position 4, discrete `description`/`public` tags) must be updated to the new layout (settings tag, position-4 options JSON, position-5 settings JSON with `renderElement`). Tests that only exercise `parseFormTemplate` on old-style fixtures should keep passing via the legacy path — do not change those; they now guard the shim.
Expected after updates: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/helpers/forms/format.js src/lib/helpers/forms.js src/lib/__tests__/
git commit -m "feat(forms): NIP-101 wire format for kind-30168 templates with legacy fallback"
```

---

### Task 2: Branching evaluator `forms/branching.js`

**Files:**
- Create: `src/lib/helpers/forms/branching.js`
- Test: `src/lib/__tests__/forms.branching.test.js` (new)

**Interfaces:**
- Consumes: `FormField` / `FormSection` / `ParsedFormTemplate` shapes from Task 1.
- Produces (used by Task 5's FormRenderer):
  - `evaluateDisplayIf(displayIf, values)` → boolean — `displayIf` is `{ rules: ConditionGroup[] } | undefined`; undefined/empty → `true`.
  - `visibleFields(fields, values)` → `FormField[]` — filters on `field.options.displayIf`.
  - `orderedSections(template)` → `FormSection[]` — sections sorted by `order` (fallback: array index); field ids missing from every section are appended as a trailing implicit section `{ id: '__rest', title: '', questionIds: [...] }`; returns `[]` when the template has no sections.
  - `resolveNextSectionId(currentSectionId, sections, fields, values)` → `string | null` — option-routing (`nextSection` on the selected option of an option field inside the current section) wins; otherwise the next section in order; `null` after the last.

`ConditionGroup` (matches Formstr PR #252): `{ questionId?, operator?, value?, nextLogic?, rules? }` with operators `equals | notEquals | contains | startsWith | endsWith | greaterThan | lessThan | greaterThanEqual | lessThanEqual` (default `equals`); groups chain via `nextLogic` (`"AND"` default) and may nest via `rules`.

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/forms.branching.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  evaluateDisplayIf,
  visibleFields,
  orderedSections,
  resolveNextSectionId
} from '$lib/helpers/forms/branching.js';

describe('evaluateDisplayIf', () => {
  it('returns true for missing/empty displayIf', () => {
    expect(evaluateDisplayIf(undefined, {})).toBe(true);
    expect(evaluateDisplayIf({ rules: [] }, {})).toBe(true);
  });

  it('evaluates equals (default) and notEquals', () => {
    const d = { rules: [{ questionId: 'q1', value: 'yes' }] };
    expect(evaluateDisplayIf(d, { q1: 'yes' })).toBe(true);
    expect(evaluateDisplayIf(d, { q1: 'no' })).toBe(false);
    expect(evaluateDisplayIf(d, {})).toBe(false); // unanswered → rule fails
    const n = { rules: [{ questionId: 'q1', operator: 'notEquals', value: 'yes' }] };
    expect(evaluateDisplayIf(n, { q1: 'no' })).toBe(true);
  });

  it('contains matches semicolon-joined multi-select answers', () => {
    const d = { rules: [{ questionId: 'q1', operator: 'contains', value: 'b' }] };
    expect(evaluateDisplayIf(d, { q1: 'a;b;c' })).toBe(true);
    expect(evaluateDisplayIf(d, { q1: 'a;c' })).toBe(false);
  });

  it('numeric operators coerce', () => {
    const d = { rules: [{ questionId: 'age', operator: 'greaterThanEqual', value: '18' }] };
    expect(evaluateDisplayIf(d, { age: '18' })).toBe(true);
    expect(evaluateDisplayIf(d, { age: '17' })).toBe(false);
  });

  it('chains AND/OR and nests groups', () => {
    const d = {
      rules: [
        { questionId: 'a', value: '1', nextLogic: 'OR' },
        { rules: [{ questionId: 'b', value: '2' }, { questionId: 'c', value: '3' }] }
      ]
    };
    expect(evaluateDisplayIf(d, { a: '1' })).toBe(true);
    expect(evaluateDisplayIf(d, { a: 'x', b: '2', c: '3' })).toBe(true);
    expect(evaluateDisplayIf(d, { a: 'x', b: '2', c: 'x' })).toBe(false);
  });
});

describe('visibleFields', () => {
  it('filters fields whose displayIf fails', () => {
    const fields = [
      { id: 'kind', type: 'radio', label: '', options: {} },
      {
        id: 'school-detail',
        type: 'text',
        label: '',
        options: { displayIf: { rules: [{ questionId: 'kind', value: 'schule' }] } }
      }
    ];
    expect(visibleFields(fields, { kind: 'schule' }).map((f) => f.id)).toEqual([
      'kind',
      'school-detail'
    ]);
    expect(visibleFields(fields, { kind: 'konfi' }).map((f) => f.id)).toEqual(['kind']);
  });
});

// The Bildungsbereich shape: step 1 routes into per-branch sections.
const bildungsbereich = {
  sections: [
    { id: 'start', title: 'Bildungsbereich', questionIds: ['bereich'] },
    { id: 'sec-schule', title: 'Schule', questionIds: ['schulfach'] },
    { id: 'sec-konfi', title: 'Konfi', questionIds: ['zielgruppe'] },
    { id: 'common', title: 'Rechte', questionIds: ['license'] }
  ],
  fields: [
    {
      id: 'bereich',
      type: 'radio',
      label: 'Bildungsbereich?',
      options: {
        options: [
          { id: 'schule', label: 'Schule', nextSection: 'sec-schule' },
          { id: 'konfi', label: 'Konfi', nextSection: 'sec-konfi' }
        ]
      }
    },
    { id: 'schulfach', type: 'text', label: '', options: {} },
    { id: 'zielgruppe', type: 'text', label: '', options: {} },
    { id: 'license', type: 'text', label: '', options: {} }
  ]
};

describe('orderedSections / resolveNextSectionId', () => {
  it('sorts by order with index fallback and collects unassigned fields', () => {
    const t = {
      sections: [
        { id: 'b', title: 'B', questionIds: ['f2'], order: 2 },
        { id: 'a', title: 'A', questionIds: ['f1'], order: 1 }
      ],
      fields: [
        { id: 'f1', type: 'text', label: '', options: {} },
        { id: 'f2', type: 'text', label: '', options: {} },
        { id: 'stray', type: 'text', label: '', options: {} }
      ]
    };
    const secs = orderedSections(t);
    expect(secs.map((s) => s.id)).toEqual(['a', 'b', '__rest']);
    expect(secs[2].questionIds).toEqual(['stray']);
  });

  it('returns [] when the template has no sections', () => {
    expect(orderedSections({ sections: [], fields: bildungsbereich.fields })).toEqual([]);
  });

  it('routes by the selected option nextSection, else linear, null at end', () => {
    const secs = orderedSections(bildungsbereich);
    expect(resolveNextSectionId('start', secs, bildungsbereich.fields, { bereich: 'konfi' })).toBe(
      'sec-konfi'
    );
    expect(resolveNextSectionId('start', secs, bildungsbereich.fields, { bereich: 'schule' })).toBe(
      'sec-schule'
    );
    // linear when no routing matches
    expect(resolveNextSectionId('sec-schule', secs, bildungsbereich.fields, {})).toBe('sec-konfi');
    expect(resolveNextSectionId('common', secs, bildungsbereich.fields, {})).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/forms.branching.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/helpers/forms/branching.js`**

```js
/**
 * Pure branching logic for NIP-101 forms: conditional field visibility
 * (displayIf rule trees, Formstr-compatible) and section routing.
 *
 * @typedef {Object} ConditionGroup
 * @property {string} [questionId]
 * @property {string | string[]} [value]
 * @property {'equals'|'notEquals'|'contains'|'startsWith'|'endsWith'|'greaterThan'|'lessThan'|'greaterThanEqual'|'lessThanEqual'} [operator]
 * @property {'AND'|'OR'} [nextLogic]
 * @property {ConditionGroup[]} [rules]
 */

/**
 * Evaluate one leaf rule against the answers map.
 * Multi-select answers are semicolon-joined optionId strings.
 * @param {ConditionGroup} rule
 * @param {Record<string, any>} values
 * @returns {boolean}
 */
function evaluateLeaf(rule, values) {
  const answered = rule.questionId ? values[rule.questionId] : undefined;
  if (answered === undefined || answered === null || answered === '') return false;
  const answer = String(answered);
  const expected = Array.isArray(rule.value) ? rule.value.join(';') : String(rule.value ?? '');

  switch (rule.operator || 'equals') {
    case 'equals':
      return answer === expected;
    case 'notEquals':
      return answer !== expected;
    case 'contains':
      return answer.split(';').includes(expected) || answer.includes(expected);
    case 'startsWith':
      return answer.startsWith(expected);
    case 'endsWith':
      return answer.endsWith(expected);
    case 'greaterThan':
      return Number(answer) > Number(expected);
    case 'lessThan':
      return Number(answer) < Number(expected);
    case 'greaterThanEqual':
      return Number(answer) >= Number(expected);
    case 'lessThanEqual':
      return Number(answer) <= Number(expected);
    default:
      return false;
  }
}

/**
 * Evaluate a rule list with AND/OR chaining (Formstr semantics: each rule's
 * nextLogic joins it to the NEXT rule; default AND). Nested groups recurse.
 * @param {ConditionGroup[]} rules
 * @param {Record<string, any>} values
 * @returns {boolean}
 */
function evaluateRules(rules, values) {
  if (!rules || rules.length === 0) return true;
  let result = evaluateOne(rules[0], values);
  for (let i = 1; i < rules.length; i++) {
    const joiner = rules[i - 1].nextLogic || 'AND';
    const next = evaluateOne(rules[i], values);
    result = joiner === 'OR' ? result || next : result && next;
  }
  return result;
}

/** @param {ConditionGroup} rule @param {Record<string, any>} values */
function evaluateOne(rule, values) {
  if (Array.isArray(rule.rules) && rule.rules.length > 0) return evaluateRules(rule.rules, values);
  return evaluateLeaf(rule, values);
}

/**
 * @param {{ rules?: ConditionGroup[] } | undefined} displayIf
 * @param {Record<string, any>} values
 * @returns {boolean} true when the field should be shown
 */
export function evaluateDisplayIf(displayIf, values) {
  if (!displayIf?.rules?.length) return true;
  return evaluateRules(displayIf.rules, values);
}

/**
 * @param {import('./format.js').FormField[]} fields
 * @param {Record<string, any>} values
 * @returns {import('./format.js').FormField[]}
 */
export function visibleFields(fields, values) {
  return fields.filter((f) => evaluateDisplayIf(f.options?.displayIf, values));
}

/**
 * Sections sorted by `order` (array index fallback), with any field ids not
 * assigned to a section collected into a trailing implicit '__rest' section.
 * Templates without sections return [] (renderer falls back to single-page).
 * @param {{ sections?: import('./format.js').FormSection[], fields: import('./format.js').FormField[] }} template
 * @returns {import('./format.js').FormSection[]}
 */
export function orderedSections(template) {
  const sections = template.sections || [];
  if (sections.length === 0) return [];
  const sorted = [...sections].sort(
    (a, b) => (a.order ?? sections.indexOf(a)) - (b.order ?? sections.indexOf(b))
  );
  const assigned = new Set(sorted.flatMap((s) => s.questionIds || []));
  const stray = template.fields.map((f) => f.id).filter((id) => !assigned.has(id));
  if (stray.length > 0) sorted.push({ id: '__rest', title: '', questionIds: stray });
  return sorted;
}

/**
 * Next section after `currentSectionId`: an option-routing rule on the
 * selected option of an option field in the current section wins; otherwise
 * linear order; null after the last section.
 * @param {string} currentSectionId
 * @param {import('./format.js').FormSection[]} sections - output of orderedSections
 * @param {import('./format.js').FormField[]} fields
 * @param {Record<string, any>} values
 * @returns {string | null}
 */
export function resolveNextSectionId(currentSectionId, sections, fields, values) {
  const idx = sections.findIndex((s) => s.id === currentSectionId);
  if (idx === -1) return sections[0]?.id ?? null;

  const current = sections[idx];
  for (const fieldId of current.questionIds || []) {
    const field = fields.find((f) => f.id === fieldId);
    const answer = values[fieldId];
    if (!field?.options?.options?.length || !answer) continue;
    const selected = field.options.options.find((o) => o.id === String(answer));
    if (selected?.nextSection && sections.some((s) => s.id === selected.nextSection)) {
      return selected.nextSection;
    }
  }
  return sections[idx + 1]?.id ?? null;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/forms.branching.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/forms/branching.js src/lib/__tests__/forms.branching.test.js
git commit -m "feat(forms): displayIf evaluator and section routing (Formstr-compatible)"
```

---

### Task 3: Option triples through the components

**Files:**
- Modify: `src/lib/components/forms/FieldsRenderer.svelte:131-188`
- Modify: `src/lib/components/forms/FormBuilder.svelte:50-107,220-235,273-289`
- Modify: `src/lib/components/forms/FormBuilderFieldRow.svelte:17-38,224-226,310-364`
- Modify: `src/lib/components/forms/FormResponses.svelte` (display mapping, around line 349)
- Test: update `src/lib/components/forms/__tests__/FieldsRenderer.test.js`, `src/lib/components/__tests__/FormBuilder.test.js`, `src/lib/components/__tests__/FormBuilderFieldRow.test.js`

**Interfaces:**
- Consumes: `FormFieldOption = { id, label, nextSection? }` from Task 1; `generateOptionId` from `$lib/helpers/forms.js`.
- Produces: FieldsRenderer emits **optionIds** as values; multi-select joins with `";"`. FormBuilder `FieldState.selectOptions` becomes `FormFieldOption[]`.

- [ ] **Step 1: Baseline**

Run: `pnpm vitest run src/lib/components/forms/__tests__/FieldsRenderer.test.js src/lib/components/__tests__/FormBuilder.test.js src/lib/components/__tests__/FormBuilderFieldRow.test.js`
Expected: PASS (before changes).

- [ ] **Step 2: Extend FieldsRenderer tests first** — in `FieldsRenderer.test.js`, add (adapting to the file's existing render/`props` helpers — reuse its patterns):

```js
it('renders option objects and emits optionIds', async () => {
  const field = {
    id: 'color',
    type: 'radio',
    label: 'Colour',
    options: {
      options: [
        { id: 'red', label: 'Rot' },
        { id: 'blue', label: 'Blau' }
      ]
    }
  };
  const onchange = vi.fn();
  render(FieldsRenderer, { fields: [field], values: {}, errors: {}, onchange });
  // labels are shown, ids are emitted
  expect(screen.getByText('Rot')).toBeTruthy();
  await fireEvent.click(screen.getByDisplayValue('red'));
  expect(onchange).toHaveBeenCalledWith('color', 'red');
});

it('joins multi-select values with semicolons', async () => {
  const field = {
    id: 'topics',
    type: 'select',
    label: 'Topics',
    options: {
      multiple: true,
      options: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' }
      ]
    }
  };
  const onchange = vi.fn();
  render(FieldsRenderer, { fields: [field], values: { topics: 'a' }, errors: {}, onchange });
  await fireEvent.click(screen.getByDisplayValue('b'));
  expect(onchange).toHaveBeenCalledWith('topics', 'a;b');
});
```

Run: `pnpm vitest run src/lib/components/forms/__tests__/FieldsRenderer.test.js`
Expected: new tests FAIL (component still renders plain strings / joins with commas).

- [ ] **Step 3: Update `FieldsRenderer.svelte`** — replace the three option loops:

Multi-select (was lines 131-155):

```svelte
{:else if field.type === 'select' && field.options?.multiple}
  <div class="mt-1 flex flex-col gap-2">
    {#each field.options?.options || [] as opt (opt.id)}
      {@const selected = (values[field.id] || '').split(';').filter(Boolean)}
      <label class="label cursor-pointer justify-start gap-2">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          value={opt.id}
          disabled={readonly}
          checked={selected.includes(opt.id)}
          onchange={(e) => {
            const current = (values[field.id] || '').split(';').filter(Boolean);
            if (/** @type {HTMLInputElement} */ (e.currentTarget).checked) current.push(opt.id);
            else {
              const idx = current.indexOf(opt.id);
              if (idx !== -1) current.splice(idx, 1);
            }
            onchange(field.id, current.join(';'));
          }}
        />
        <span class="label-text">{opt.label}</span>
      </label>
    {/each}
  </div>
```

Single select (was lines 156-170) — options become:

```svelte
  {#each field.options?.options || [] as opt (opt.id)}
    <option value={opt.id}>{opt.label}</option>
  {/each}
```

Radio (was lines 171-187) — inputs become:

```svelte
  {#each field.options?.options || [] as opt (opt.id)}
    <label class="label cursor-pointer justify-start gap-2">
      <input
        type="radio"
        class="radio radio-sm"
        name={field.id}
        value={opt.id}
        disabled={readonly}
        checked={values[field.id] === opt.id}
        onchange={() => onchange(field.id, opt.id)}
      />
      <span class="label-text">{opt.label}</span>
    </label>
  {/each}
```

Run: `pnpm vitest run src/lib/components/forms/__tests__/FieldsRenderer.test.js src/lib/components/forms/__tests__/FieldsRenderer.allowCustom.test.js`
Expected: PASS (fix any pre-existing expectations that asserted string options / comma joins).

- [ ] **Step 4: Update FormBuilder + FormBuilderFieldRow**

`FormBuilder.svelte`: change the `FieldState` typedef property `@property {string[]} selectOptions` → `@property {import('$lib/helpers/forms.js').FormFieldOption[]} selectOptions` (lines 60 and the twin typedef in `FormBuilderFieldRow.svelte:26`). The two mapping sites (lines 100 and 229, `selectOptions: f.options?.options || []`) stay textually identical — parse now yields option objects. In `publish()` (line 284) the mapping also stays: `options: f.selectOptions` already carries `{id,label}` objects which `buildFormTemplateTags` now expects.

`FormBuilderFieldRow.svelte` manual options editor (lines 310-364): import `generateOptionId` alongside `generateFieldId` (line 6), then:

- Badge list: `{#each field.selectOptions as opt, j (opt.id)}` and render `{opt.label}` instead of `{opt}`.
- Both add-option handlers (`onkeydown` Enter and the `+` button) change `field.selectOptions.push(value)` to:

```js
field.selectOptions.push({
  id: generateOptionId(value, field.selectOptions.map((o) => o.id)),
  label: value
});
```

- `fieldMode` seed (line 225) is unchanged (`selectOptions.length` still works).

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilder.test.js src/lib/components/__tests__/FormBuilderFieldRow.test.js`
Expected: PASS after updating any assertions that treated options as plain strings.

- [ ] **Step 5: FormResponses optionId→label display**

In `FormResponses.svelte`, add a helper in the script block and use it where answers render (currently `{values[field.id] || '—'}` around line 349):

```js
/**
 * Map stored optionIds back to labels for display. Non-option fields and
 * unknown ids pass through unchanged (covers legacy label-valued responses).
 * @param {import('$lib/helpers/forms.js').FormField} field
 * @param {string | undefined} raw
 */
function displayValue(field, raw) {
  if (!raw) return raw;
  const opts = field.options?.options;
  if (!opts?.length) return raw;
  const byId = new Map(opts.map((o) => [o.id, o.label]));
  return raw
    .split(';')
    .map((v) => byId.get(v) ?? v)
    .join(', ');
}
```

Template: `{displayValue(field, values[field.id]) || '—'}`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/forms/ src/lib/components/__tests__/
git commit -m "feat(forms): optionId-based choice fields (NIP-101) across renderer, builder, responses"
```

---

### Task 4: Response encoding + NIP-44 helper unification

**Files:**
- Create: `src/lib/helpers/forms/crypto.js`
- Modify: `src/lib/helpers/forms.js` (`buildResponseTags` 4th element; re-export crypto helpers)
- Modify: `src/routes/forms/[naddr=naddr]/respond/+page.svelte:92-142` (+ its `hasNip44`/`public`-tag checks)
- Modify: `src/lib/components/membership/MembershipApplicationForm.svelte` (lines ~110-148 decrypt, ~196-235 encrypt)
- Modify: `src/lib/components/forms/FormResponses.svelte:238-262` (decrypt)
- Test: `src/lib/__tests__/forms.crypto.test.js` (new)

**Interfaces:**
- Produces:
  - `buildResponseTags(values)` → `['response', id, value, '{}'][]`
  - `nip44EncryptWith(signer, counterpartyPubkey, plaintext)` → Promise<string> — tries `signer.nip44.encrypt`, then `signer.nip44Encrypt`, else throws `Error('Signer does not support NIP-44 encryption')`.
  - `nip44DecryptWith(signer, counterpartyPubkey, ciphertext)` → Promise<string> — symmetric (`signer.nip44.decrypt` / `signer.nip44Decrypt`).
  - `signerHasNip44(signer)` → boolean.
- Consumes: `parseFormTemplate(...).isPublic` from Task 1 (replaces raw `['public']`-tag checks — the new format stores it in the settings JSON, so raw tag checks are now WRONG for new-format events).

- [ ] **Step 1: Write failing tests** — `src/lib/__tests__/forms.crypto.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  nip44EncryptWith,
  nip44DecryptWith,
  signerHasNip44
} from '$lib/helpers/forms/crypto.js';
import { buildResponseTags } from '$lib/helpers/forms.js';

describe('nip44 signer helpers', () => {
  it('uses the nested nip44.encrypt surface when present', async () => {
    const encrypt = vi.fn().mockResolvedValue('cipher');
    expect(await nip44EncryptWith({ nip44: { encrypt } }, 'pk', 'plain')).toBe('cipher');
    expect(encrypt).toHaveBeenCalledWith('pk', 'plain');
  });
  it('falls back to the flat nip44Encrypt surface', async () => {
    const nip44Encrypt = vi.fn().mockResolvedValue('cipher');
    expect(await nip44EncryptWith({ nip44Encrypt }, 'pk', 'plain')).toBe('cipher');
  });
  it('throws without any nip44 surface', async () => {
    await expect(nip44EncryptWith({}, 'pk', 'plain')).rejects.toThrow(/NIP-44/);
  });
  it('decrypt mirrors both surfaces and signerHasNip44 detects them', async () => {
    const decrypt = vi.fn().mockResolvedValue('plain');
    expect(await nip44DecryptWith({ nip44: { decrypt } }, 'pk', 'c')).toBe('plain');
    const nip44Decrypt = vi.fn().mockResolvedValue('plain');
    expect(await nip44DecryptWith({ nip44Decrypt }, 'pk', 'c')).toBe('plain');
    expect(signerHasNip44({ nip44: { decrypt } })).toBe(true);
    expect(signerHasNip44({ nip44Decrypt })).toBe(true);
    expect(signerHasNip44({})).toBe(false);
  });
});

describe('buildResponseTags', () => {
  it('emits 4-element NIP-101 response tags', () => {
    expect(buildResponseTags({ color: 'red', name: 'Ada' })).toEqual([
      ['response', 'color', 'red', '{}'],
      ['response', 'name', 'Ada', '{}']
    ]);
  });
});
```

Run: `pnpm vitest run src/lib/__tests__/forms.crypto.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement `src/lib/helpers/forms/crypto.js`**

```js
/**
 * NIP-44 signer-surface adapters. Different signers expose either a nested
 * `signer.nip44.{encrypt,decrypt}` or flat `signer.nip44Encrypt/-Decrypt`
 * API; every forms call site goes through these helpers.
 */

/** @param {any} signer @param {string} counterpartyPubkey @param {string} plaintext */
export async function nip44EncryptWith(signer, counterpartyPubkey, plaintext) {
  if (signer?.nip44?.encrypt) return signer.nip44.encrypt(counterpartyPubkey, plaintext);
  if (signer?.nip44Encrypt) return signer.nip44Encrypt(counterpartyPubkey, plaintext);
  throw new Error('Signer does not support NIP-44 encryption');
}

/** @param {any} signer @param {string} counterpartyPubkey @param {string} ciphertext */
export async function nip44DecryptWith(signer, counterpartyPubkey, ciphertext) {
  if (signer?.nip44?.decrypt) return signer.nip44.decrypt(counterpartyPubkey, ciphertext);
  if (signer?.nip44Decrypt) return signer.nip44Decrypt(counterpartyPubkey, ciphertext);
  throw new Error('Signer does not support NIP-44 decryption');
}

/** @param {any} signer */
export function signerHasNip44(signer) {
  return !!(signer?.nip44?.decrypt || signer?.nip44Decrypt);
}
```

In `forms.js`: `buildResponseTags` becomes

```js
export function buildResponseTags(values) {
  return Object.entries(values).map(([id, value]) => ['response', id, String(value ?? ''), '{}']);
}
```

(`parseResponseTags` already ignores extra elements — leave it.) Add `export { nip44EncryptWith, nip44DecryptWith, signerHasNip44 } from './forms/crypto.js';`

- [ ] **Step 3: Migrate the three call sites**

- `respond/+page.svelte`: replace both `formEvent.tags.some((t) => t[0] === 'public')` checks (lines 104 and 154) with `parseFormTemplate(formEvent).isPublic` (add a `const parsedTemplate = $derived(formEvent ? parseFormTemplate(formEvent) : null)` and use `parsedTemplate?.isPublic`); replace `manager.active.signer.nip44.encrypt(...)` (line 119) with `nip44EncryptWith(manager.active.signer, creatorPubkey, plaintext)`; replace the page's local `hasNip44(...)` usage (line 154 area — find its definition in the same file and delete it) with `signerHasNip44` imported from `$lib/helpers/forms.js`.
- `MembershipApplicationForm.svelte`: line ~128 `active.signer.nip44.decrypt(adminPubkey, response.content)` → `nip44DecryptWith(active.signer, adminPubkey, response.content)`; the guard `if (!active.signer?.nip44)` above it → `if (!signerHasNip44(active.signer))`; line ~214-216 `signer?.nip44Encrypt` branch → unconditional `content = await nip44EncryptWith(signer, adminPubkey, plaintext)` inside the existing try/catch (keep the surrounding public/encrypted branching).
- `FormResponses.svelte`: line ~252 `manager.active.signer.nip44.decrypt(...)` → `nip44DecryptWith(manager.active.signer, response.pubkey, response.content)` (keep the current counterparty argument exactly as it is today — it decrypts with the responder's pubkey).

- [ ] **Step 4: Verify no stray raw surfaces remain in forms code**

Run: `grep -rn "nip44\." src/lib/components/forms src/lib/components/membership src/routes/forms | grep -v crypto.js | grep -v __tests__`
Expected: no matches (all forms/membership call sites go through the helpers). Other domains (DMs etc.) are out of scope — do not touch them.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/lib/__tests__/forms.crypto.test.js src/lib/__tests__/forms.test.js`
Expected: PASS (update any `buildResponseTags` expectations to the 4-element shape).

- [ ] **Step 6: Commit**

```bash
git add src/lib/helpers/forms/crypto.js src/lib/helpers/forms.js src/routes/forms src/lib/components/membership src/lib/components/forms src/lib/__tests__/
git commit -m "feat(forms): NIP-101 response tags + unified NIP-44 signer helpers"
```

---

### Task 5: Sections wizard mode in FormRenderer

**Files:**
- Modify: `src/lib/components/forms/FormRenderer.svelte` (full file — current version is 109 lines, shown in repo)
- Test: `src/lib/components/__tests__/FormRenderer.sections.test.js` (new); keep `FormRenderer.text-array.test.js` green

**Interfaces:**
- Consumes: `orderedSections`, `resolveNextSectionId`, `visibleFields` from Task 2 (import from `$lib/helpers/forms/branching.js`); `parseFormTemplate`/`validateField` as today.
- Produces: unchanged public props `{ formEvent, onsubmit?, readonly?, initialValues? }`. Templates without sections render exactly as before (single page, one Submit). Templates with sections render one section at a time with Back/Next, progress `Step x/y`, option-routing on Next, `displayIf`-filtered fields, per-section validation on Next, full-form validation of visible fields on final Submit.

- [ ] **Step 1: Write failing component test** — `src/lib/components/__tests__/FormRenderer.sections.test.js` (jsdom; follow the render style of `FormRenderer.text-array.test.js`):

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
import { buildFormTemplateTags } from '$lib/helpers/forms.js';

function templateEvent() {
  const fields = [
    {
      id: 'bereich',
      type: 'radio',
      label: 'Bereich?',
      options: {
        required: true,
        options: [
          { id: 'schule', label: 'Schule', nextSection: 'sec-schule' },
          { id: 'konfi', label: 'Konfi', nextSection: 'sec-konfi' }
        ]
      }
    },
    { id: 'schulfach', type: 'text', label: 'Schulfach', options: {} },
    { id: 'zielgruppe', type: 'text', label: 'Zielgruppe', options: {} }
  ];
  const sections = [
    { id: 'start', title: 'Start', questionIds: ['bereich'] },
    { id: 'sec-schule', title: 'Schule', questionIds: ['schulfach'] },
    { id: 'sec-konfi', title: 'Konfi', questionIds: ['zielgruppe'] }
  ];
  return {
    kind: 30168,
    pubkey: 'pk',
    content: '',
    created_at: 0,
    tags: buildFormTemplateTags('wiz', fields, { name: 'Wizard', sections })
  };
}

describe('FormRenderer sections mode', () => {
  it('shows one section at a time and routes by the chosen option', async () => {
    render(FormRenderer, { formEvent: templateEvent(), onsubmit: vi.fn() });
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.queryByLabelText('Schulfach')).toBeNull();

    await fireEvent.click(screen.getByDisplayValue('konfi'));
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    expect(screen.getByText('Konfi')).toBeTruthy();
    expect(screen.queryByText('Schule', { selector: 'h3' })).toBeNull();
  });

  it('blocks Next on invalid required fields in the current section', async () => {
    render(FormRenderer, { formEvent: templateEvent(), onsubmit: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    // still on section 1, error shown
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText(/required/i)).toBeTruthy();
  });

  it('submits from the last reached section and Back returns along history', async () => {
    const onsubmit = vi.fn();
    render(FormRenderer, { formEvent: templateEvent(), onsubmit });
    await fireEvent.click(screen.getByDisplayValue('schule'));
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    await fireEvent.click(screen.getByRole('button', { name: /zurück|back/i }));
    expect(screen.getByText('Start')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    // sec-schule routes linearly to sec-konfi; sec-konfi is last → Submit visible
    await fireEvent.click(screen.getByRole('button', { name: /weiter|next/i }));
    await fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ bereich: 'schule' }));
  });
});
```

Run: `pnpm vitest run src/lib/components/__tests__/FormRenderer.sections.test.js`
Expected: FAIL (no sections mode yet).

- [ ] **Step 2: Rewrite `FormRenderer.svelte`**

Keep the existing script setup (parse, `values`/`errors` state, init effect, `handleFieldChange`) and add:

```js
import {
  orderedSections,
  resolveNextSectionId,
  visibleFields
} from '$lib/helpers/forms/branching.js';

const sections = $derived(form ? orderedSections(form) : []);
const hasSections = $derived(sections.length > 0);

let currentSectionId = $state('');
/** @type {string[]} navigation history for Back */
let sectionHistory = [];

$effect(() => {
  if (hasSections && !currentSectionId) currentSectionId = sections[0].id;
});

const currentSection = $derived(sections.find((s) => s.id === currentSectionId));
const currentIndex = $derived(sections.findIndex((s) => s.id === currentSectionId));

/** Fields of the current section, displayIf-filtered (all fields when no sections). */
const currentFields = $derived.by(() => {
  const all = visibleFields(form?.fields || [], values);
  if (!hasSections || !currentSection) return all;
  const inSection = new Set(currentSection.questionIds || []);
  return all.filter((f) => inSection.has(f.id));
});

const nextSectionId = $derived(
  hasSections && currentSection
    ? resolveNextSectionId(currentSection.id, sections, form.fields, values)
    : null
);
const isLastSection = $derived(hasSections && nextSectionId === null);

/** Validate a set of fields into `errors`; returns true when clean. */
function validateFields(fieldList) {
  /** @type {Record<string, string | null>} */
  const newErrors = { ...errors };
  let hasError = false;
  for (const field of fieldList) {
    const raw = values[field.id];
    let toCheck = raw;
    if (field.type === 'text-array') {
      const arr = Array.isArray(raw) ? raw.map((s) => s.trim()).filter(Boolean) : [];
      values[field.id] = arr;
      toCheck = arr;
    }
    const err = validateField(field, toCheck || '');
    newErrors[field.id] = err;
    if (err) hasError = true;
  }
  errors = newErrors;
  return !hasError;
}

function goNext() {
  if (!validateFields(currentFields)) return;
  if (nextSectionId) {
    sectionHistory.push(currentSectionId);
    currentSectionId = nextSectionId;
  }
}

function goBack() {
  const prev = sectionHistory.pop();
  if (prev) currentSectionId = prev;
}

function handleSubmit() {
  // validate ALL currently-visible fields (across sections) before submitting
  if (!validateFields(visibleFields(form.fields, values))) return;
  onsubmit?.(values);
}
```

(The old `handleSubmit` body is replaced by `validateFields` + this thinner version — same validation semantics for the no-sections case, since `visibleFields` with no `displayIf` rules returns all fields.)

Template below the header block:

```svelte
{#if hasSections && currentSection}
  <div class="flex items-center justify-between">
    <h3 class="font-semibold">{currentSection.title}</h3>
    <span class="text-sm text-base-content/50"
      >{m.form_section_progress({ current: currentIndex + 1, total: sections.length })}</span
    >
  </div>
  {#if currentSection.description}
    <p class="text-sm text-base-content/60">{currentSection.description}</p>
  {/if}
{/if}

<FieldsRenderer fields={currentFields} {values} {errors} {readonly} onchange={handleFieldChange} />

{#if !readonly}
  {#if hasSections && !isLastSection}
    <div class="flex gap-2">
      {#if sectionHistory.length > 0}
        <button class="btn btn-ghost" onclick={goBack}>{m.form_section_back()}</button>
      {/if}
      <button class="btn flex-1 btn-primary" onclick={goNext}>{m.form_section_next()}</button>
    </div>
  {:else}
    <div class="flex gap-2">
      {#if hasSections && sectionHistory.length > 0}
        <button class="btn btn-ghost" onclick={goBack}>{m.form_section_back()}</button>
      {/if}
      <button class="btn flex-1 btn-primary" onclick={handleSubmit}>Submit</button>
    </div>
  {/if}
{/if}
```

Add three Paraglide messages to `messages/en.json` and `messages/de.json` (respect the `@`-before-placeholder rule):

```json
"form_section_progress": "Step {current}/{total}",
"form_section_back": "Back",
"form_section_next": "Next"
```

(de: `"Schritt {current}/{total}"`, `"Zurück"`, `"Weiter"`.)

`sectionHistory` MUST be `let sectionHistory = $state([])` (not plain `let`): the template reads `sectionHistory.length` for Back-button visibility, and `$state` array mutations (`push`/`pop`) are reactive in Svelte 5.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/lib/components/__tests__/FormRenderer.sections.test.js src/lib/components/__tests__/FormRenderer.text-array.test.js`
Expected: PASS — the text-array test exercises the no-sections path and must pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/forms/FormRenderer.svelte src/lib/components/__tests__/ messages/
git commit -m "feat(forms): sections wizard mode with displayIf and option routing in FormRenderer"
```

---

### Task 6: Field-type registry foundation

**Files:**
- Create: `src/lib/config/form-field-types.js`
- Create: `src/lib/components/forms/fields/DateField.svelte`
- Modify: `src/lib/components/forms/FieldsRenderer.svelte` (registry consult + unknown-type fallback; remove `date` from the native input chain)
- Test: `src/lib/components/forms/__tests__/FieldsRenderer.registry.test.js` (new)

**Interfaces:**
- Produces: `getFieldComponent(type)` → Svelte component | undefined. Registry contract — every registered component accepts exactly:
  `{ field: FormField, value: any, error: string | null, readonly: boolean, onchange: (value: any) => void }`.
- Consumes: `EuropeanDateInput` (`value` bindable ISO string, `id`, `placeholder`, `...rest` passthrough).

- [ ] **Step 1: Write failing tests** — `FieldsRenderer.registry.test.js` (jsdom):

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

describe('field-type registry', () => {
  it('renders registered date type via DateField (German placeholder mask)', () => {
    const field = { id: 'when', type: 'date', label: 'Datum', options: {} };
    render(FieldsRenderer, { fields: [field], values: {}, errors: {}, onchange: vi.fn() });
    expect(screen.getByPlaceholderText('TT.MM.JJJJ')).toBeTruthy();
  });

  it('falls back to a text input for unknown renderElement types', async () => {
    const field = { id: 'mystery', type: 'holo-picker-9000', label: 'Mystery', options: {} };
    const onchange = vi.fn();
    render(FieldsRenderer, { fields: [field], values: {}, errors: {}, onchange });
    const input = screen.getByLabelText('Mystery');
    expect(input.getAttribute('type')).toBe('text');
    await fireEvent.input(input, { target: { value: 'hello' } });
    expect(onchange).toHaveBeenCalledWith('mystery', 'hello');
  });
});
```

Run: `pnpm vitest run src/lib/components/forms/__tests__/FieldsRenderer.registry.test.js`
Expected: FAIL (date renders as native input; unknown type renders nothing).

- [ ] **Step 2: Implement registry + DateField**

`src/lib/config/form-field-types.js`:

```js
/**
 * Field-type registry: maps a field's rich type (settings.renderElement on
 * the wire) to a Svelte component implementing the registry contract
 * { field, value, error, readonly, onchange }. Types absent here fall back
 * to FieldsRenderer's built-in branches, and unknown types degrade to a
 * plain text input (NIP-101: everything derives from text).
 */
import DateField from '$lib/components/forms/fields/DateField.svelte';

/** @type {Record<string, any>} */
export const FIELD_TYPE_REGISTRY = {
  date: DateField
};

/** @param {string} type */
export function getFieldComponent(type) {
  return FIELD_TYPE_REGISTRY[type];
}
```

`src/lib/components/forms/fields/DateField.svelte`:

```svelte
<script>
  import EuropeanDateInput from '$lib/components/shared/EuropeanDateInput.svelte';

  /** Registry-contract wrapper around EuropeanDateInput (bindable ISO value). */
  let { field, value = '', error = null, readonly = false, onchange } = $props();

  let local = $state(value);
  $effect(() => {
    local = value; // reflect external prefill
  });
  $effect(() => {
    if (local !== value) onchange(local);
  });
</script>

<EuropeanDateInput
  id={field.id}
  bind:value={local}
  placeholder={field.options?.placeholder || 'TT.MM.JJJJ'}
  class={`input-bordered input w-full ${error ? 'input-error' : ''}`}
  disabled={readonly}
/>
```

`FieldsRenderer.svelte`: import the registry and insert a branch **before** the built-in chain (right after the `field.vocab` branch), remove `'date'` from the native input condition on line 57, and add a final unknown-type fallback:

```svelte
{:else if getFieldComponent(field.type)}
  {@const FieldComponent = getFieldComponent(field.type)}
  <FieldComponent
    {field}
    value={values[field.id] ?? ''}
    error={errors[field.id] ?? null}
    {readonly}
    onchange={(/** @type {any} */ v) => onchange(field.id, v)}
  />
{:else if field.type === 'text' || field.type === 'email' || field.type === 'url' || field.type === 'number'}
  … existing input branch, minus 'date' …
```

…and change the chain's terminal branch: the current `{:else if field.type === 'radio'}` block gets a plain `{:else}` fallback after it:

```svelte
{:else}
  <input
    id={field.id}
    type="text"
    class="input-bordered input w-full"
    class:input-error={errors[field.id]}
    placeholder={field.options?.placeholder || ''}
    disabled={readonly}
    value={values[field.id] ?? ''}
    oninput={(e) => onchange(field.id, /** @type {HTMLInputElement} */ (e.currentTarget).value)}
  />
{/if}
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/lib/components/forms/__tests__/`
Expected: PASS (all FieldsRenderer suites — the date change must not break existing expectations; if an existing test asserted a native `type="date"` input, update it to the DateField mask).

- [ ] **Step 4: Commit**

```bash
git add src/lib/config/form-field-types.js src/lib/components/forms/
git commit -m "feat(forms): field-type registry with DateField and text-input fallback"
```

---

### Task 7: Option labels in AMB emission (`form-to-amb.js`)

**Files:**
- Modify: `src/lib/helpers/form-to-amb.js:163-188` (`emitForTarget` scalar branch)
- Test: extend `src/lib/__tests__/form-to-amb.test.js`

**Interfaces:**
- Consumes: `FormFieldOption[]` on `field.options.options` (Task 1); FieldsRenderer values now hold optionIds, `";"`-joined for multi (Task 3).
- Produces: 30142 tags carry human-readable option **labels**, never optionIds (30142 events must look identical regardless of which form encoding produced them).

- [ ] **Step 1: Write failing test** — add to `form-to-amb.test.js`:

```js
it('maps optionIds back to labels for scalar option fields', () => {
  const form = {
    pubkey: 'pk',
    dTag: 'f',
    fields: [
      {
        id: 'level',
        type: 'select',
        label: 'Level',
        output: 'amb:educationalLevel',
        options: {
          multiple: true,
          options: [
            { id: 'primary', label: 'Primarstufe' },
            { id: 'secondary', label: 'Sekundarstufe' }
          ]
        }
      }
    ]
  };
  const tags = buildAMBResourceTags({
    form,
    formRelay: '',
    values: { level: 'primary;secondary' },
    selectedConcepts: {}
  });
  expect(tags).toContainEqual(['educationalLevel', 'Primarstufe']);
  expect(tags).toContainEqual(['educationalLevel', 'Sekundarstufe']);
  expect(tags.some((t) => t[1] === 'primary')).toBe(false);
});
```

Run: `pnpm vitest run src/lib/__tests__/form-to-amb.test.js`
Expected: new test FAILS (ids pass through today).

- [ ] **Step 2: Implement** — in `emitForTarget`, replace the scalar branch:

```js
  // scalar field — emit as flat tag(s); option fields resolve ids → labels
  const optionList = field.options?.options;
  const byId = optionList?.length ? new Map(optionList.map((o) => [o.id, o.label])) : null;
  const vals = Array.isArray(raw) ? raw : byId ? String(raw).split(';') : [raw];
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    out.push([keyBase, byId ? (byId.get(String(v)) ?? String(v)) : String(v)]);
  }
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/lib/__tests__/form-to-amb.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/helpers/form-to-amb.js src/lib/__tests__/form-to-amb.test.js
git commit -m "fix(forms): resolve optionIds to labels in AMB resource emission"
```

---

### Task 8: Membership templates on the new encoding

**Files:**
- Modify: `src/lib/__tests__/edufeedMembershipForm.test.js` (assert new format)
- Verify (no code change expected): `scripts/publish-edufeed-forms.mjs`, `src/lib/helpers/forms.js` membership definitions

**Interfaces:**
- Consumes: `createEdufeedMembershipForm` / `createDefaultMembershipForm` (unchanged signatures — they call `buildFormTemplateTags`, so they emit the new format automatically).

- [ ] **Step 1: Add format assertions** — in `edufeedMembershipForm.test.js` add:

```js
it('emits the NIP-101 encoding (settings tag, field settings with renderElement)', () => {
  const { dTag, fields } = getEdufeedMembershipForm();
  const tags = buildFormTemplateTags(dTag, fields, { name: 'x' });
  expect(tags.some((t) => t[0] === 'settings')).toBe(true);
  const motivation = tags.find((t) => t[0] === 'field' && t[1] === 'motivation');
  expect(motivation[2]).toBe('text');
  expect(JSON.parse(motivation[4])).toEqual([]);
  expect(JSON.parse(motivation[5]).renderElement).toBe('textarea');
  expect(JSON.parse(motivation[5]).required).toBe(true);
});
```

Run: `pnpm vitest run src/lib/__tests__/edufeedMembershipForm.test.js`
Expected: PASS (if it fails, Task 1's build is wrong — fix there, not here).

- [ ] **Step 2: Check the publish script still builds** — read `scripts/publish-edufeed-forms.mjs`; if it constructs tags itself instead of calling `createEdufeedMembershipForm`/`buildFormTemplateTags`, refactor it to call the helper (same pattern as `src/lib/helpers/forms.js:417-423`). If it already delegates, no change.

- [ ] **Step 3: Record the operator step** — append to the plan-execution notes / final PR description:

> After merge+deploy, an admin must re-publish both membership templates (`node scripts/publish-edufeed-forms.mjs`, needs the publishing key in env) so the live events use the NIP-101 encoding. Until then the legacy parser path serves them. The legacy path is removed in a later cleanup, **not** in this plan.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/edufeedMembershipForm.test.js scripts/
git commit -m "test(forms): membership templates assert NIP-101 encoding"
```

---

### Task 9: NIP-101-EDU extension spec document

**Files:**
- Create: `docs/nips/nip-101-edu.md`

**Interfaces:** none (documentation). Content must match what Tasks 1-7 actually implement — copy tag layouts from `format.js`, not from memory.

- [ ] **Step 1: Write the doc** — structure (each section normative, with a JSON event example using the layouts from this plan's "New wire format" preamble):

1. **Preamble** — status (draft), relationship to NIP-101 (PR #1190, base layer adopted as-is; which revision: link the `abh3po/nips` `nostr-form` branch), scope note that Formstr's private-form key apparatus is deliberately not implemented.
2. **Base conformance** — field tag positions, option pairs/triples, `settings` tag; note that all edufeed additions are additive tags or settings keys so NIP-101 clients degrade gracefully.
3. **`field-vocab`** — SKOS scheme binding to kind 39737 (`["field-vocab", fieldId, "a", "39737:<pk>:<d>", relay]`); answer values for vocab fields are concept ids; reference NIP-VOCAB kinds 39737/39738.
4. **`field-output` and event composition** — `amb:<property>` / `ext` semantics; the produced kind-30142 back-reference `["a", "30168:<pk>:<d>", relay, "form"]` and NIP-32 `metadata-form` labels.
5. **Sections** (`settings.sections`), **`displayIf`** (ConditionGroup schema incl. operator list), **`nextSection`** option config — normative schemas as implemented in `branching.js`, each with a worked Bildungsbereich-style example.
6. **Fork provenance** — `["a", <coord>, relay, "forkOf"]`.
7. **Responses** — 4-element response tags, optionId values, `";"` multi-select join, encrypted-response encoding (JSON-stringified tag array, NIP-44 responder→author, `["encrypted"]` marker).

- [ ] **Step 2: Commit (force-add — docs/ is gitignored)**

```bash
git add -f docs/nips/nip-101-edu.md
git commit -m "docs: NIP-101-EDU extension spec for edufeed form templates"
```

---

### Task 10: Interop fixtures + full verification

**Files:**
- Create: `src/lib/__tests__/forms.interop.test.js`
- Test: whole suite + svelte-check + lint

**Interfaces:** consumes `parseFormTemplate` only.

- [ ] **Step 1: Write the interop test** — `src/lib/__tests__/forms.interop.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseFormTemplate } from '$lib/helpers/forms.js';

// Shape from the NIP-101 spec example (abh3po/nips nostr-form branch)
const nip101SpecExample = {
  kind: 30168,
  pubkey: 'author',
  content: '',
  created_at: 0,
  tags: [
    ['d', 'spec-form'],
    ['name', 'Name of the form'],
    ['settings', JSON.stringify({ description: 'description of the form.' })],
    ['field', 'aX1', 'text', 'What is your age?', '[]', JSON.stringify({ required: true })],
    [
      'field',
      'bY2',
      'option',
      'Favourite drink?',
      JSON.stringify([
        ['o1', 'Coffee'],
        ['o2', 'Tea']
      ]),
      '{}'
    ]
  ]
};

describe('NIP-101 interop', () => {
  it('parses the NIP-101 spec example', () => {
    const p = parseFormTemplate(nip101SpecExample);
    expect(p.name).toBe('Name of the form');
    expect(p.description).toBe('description of the form.');
    expect(p.fields).toHaveLength(2);
    expect(p.fields[0].type).toBe('text'); // no renderElement → inputType fallback
    expect(p.fields[0].options.required).toBe(true);
    expect(p.fields[1].type).toBe('select'); // option → select fallback
    expect(p.fields[1].options.options).toEqual([
      { id: 'o1', label: 'Coffee' },
      { id: 'o2', label: 'Tea' }
    ]);
  });

  it('tolerates a real encrypted Formstr template (captured 2026-07-16 from relay.damus.io)', () => {
    const encrypted = {
      kind: 30168,
      pubkey: '671e8d7b0000000000000000000000000000000000000000000000000000abcd',
      content: 'Ao1zaZrLE5SJZ8w54pcLNIGlN7PqM8CMAJqmV6EX65C9HMVJHaGgBmPLaVXn8Jo2',
      created_at: 1784201148,
      tags: [
        ['d', 'cezpPW'],
        ['name', 'Event RSVP'],
        ['relay', 'wss://relay.damus.io/'],
        ['relay', 'wss://nos.lol']
      ]
    };
    const p = parseFormTemplate(encrypted);
    expect(p.name).toBe('Event RSVP');
    expect(p.fields).toEqual([]); // fields are in encrypted content we don't support — degrade, don't crash
  });

  it('tolerates the lotus/nostroogle JSON dialect', () => {
    const lotus = {
      kind: 30168,
      pubkey: '7ea54f890000000000000000000000000000000000000000000000000000abcd',
      content: JSON.stringify({ id: 'form-x', title: 'Untitled form', questions: [] }),
      created_at: 1784188079,
      tags: [
        ['d', 'form-x'],
        ['title', 'Untitled form'],
        ['t', 'nostroogle-form'],
        ['client', 'lotus']
      ]
    };
    expect(() => parseFormTemplate(lotus)).not.toThrow();
    expect(parseFormTemplate(lotus).fields).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/lib/__tests__/forms.interop.test.js`
Expected: PASS (these should pass already if Task 1 was implemented correctly; a failure here is a Task 1 bug).

- [ ] **Step 2: Full verification**

Run, in order:
1. `pnpm vitest run src/lib/__tests__/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/` — Expected: PASS (known-flaky inbox/DM files live outside these paths).
2. `pnpm run check` — Expected: 0 errors (JSDoc types across the new modules).
3. `pnpm run lint` — Expected: clean (prettier runs via lint-staged on commit anyway).
4. `pnpm test` (full suite, once, not while the user is browser-testing) — Expected: PASS modulo the documented flaky inbox/DM parallel failures; anything ELSE failing must be fixed before finishing.

- [ ] **Step 3: Manual smoke via dev server** (use the `verify` skill before claiming done): create a form with select options in `/forms/new`, publish, fill it via `/forms/<naddr>/respond`, confirm the response event's tags in the console/network show optionIds + 4-element response tags; open an old-dialect membership form (if reachable) and confirm it still renders via the legacy path.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/forms.interop.test.js
git commit -m "test(forms): NIP-101 and foreign-dialect interop fixtures"
```

---

## Out of scope (next plan: template-driven AMB resource form)

Spec Section 3 items deliberately NOT in this plan: rich field adapters beyond `date` (image-licensed, creator, curriculum, amb-relation), the single-AMB-emission-path rework through `convertFormDataToAMB`, `templateNaddr` on the variant registry, the published AMB form template + authoring script, enrichment prefill, draft-store re-keying, and the E2E flow (`e2e/COVERAGE.md`). Also deferred: removing the legacy parser path (needs the operator re-publish from Task 8 first) and any Phase-2 builder UX (sections/rule editors).
