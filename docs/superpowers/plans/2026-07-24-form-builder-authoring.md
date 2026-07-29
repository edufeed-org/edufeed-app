# Form Builder Authoring UI + AMB Reachability Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/forms/new` the UI to author sections/steps, minimal branching (option routing + single-condition show-if), and field-output/vocab on every field type — and make the template-driven AMB form reachable at `/create/resource/amb`.

**Architecture:** Sections are modelled *while editing* as `type:'section'` divider entries in the builder's existing flat `fields` list (reusing all its add/remove/drag/reorder machinery). Two pure functions convert between that editing list and the wire model (`settings.sections`). The engine (serialization, branching evaluation, wizard rendering) is unchanged from Phase 1a — this is UI on top.

**Tech Stack:** SvelteKit + Svelte 5 runes, JSDoc types, Vitest (node + jsdom), applesauce EventFactory (already used by the builder). No new deps.

**Spec:** `docs/superpowers/specs/2026-07-24-form-builder-authoring-design.md`. Stacks on `feature/nostr-metadata-forms` (Phase 1a + 1b already merged into it).

## Global Constraints

- Work in the existing worktree `/home/laoc/coding/edufeed/edufeed-app/.claude/worktrees/nip101-forms-alignment` on branch `feature/nostr-metadata-forms`. **Never** write files by the main-checkout absolute path — it strays out of the worktree.
- Package manager **pnpm**. Unit tests `pnpm vitest run <file>` (node-env files start `/** @vitest-environment node */`, component files jsdom).
- `pnpm run check` 0 errors after every task; `pnpm run lint` clean. JSDoc casts additive only.
- Svelte 5 runes: `$state` for reactive UI, plain `let` for refs, `$derived` pure. `$state` array mutation (`push`/`splice`) is reactive.
- Keyed `{#each}` over builder items must key on the item `id` (already unique via `generateFieldId`/`generateOptionId`); section ids likewise unique.
- Paraglide: never put `@` directly before a `{param}` in a message value. New UI strings go in BOTH `messages/en.json` and `messages/de.json`.
- `docs/` is gitignored — force-add (`git add -f`) anything under `docs/`.
- The `section` divider is a builder-editing representation ONLY; it MUST NOT be emitted as a wire `field` tag (see Task 1 `extractSections`).
- Do NOT run the full `pnpm test` suite while iterating (Paraglide HMR storm + known-flaky inbox/DM/GlobalFAB); use targeted files per task, full suite only in the final task.

## Data shapes (referenced across tasks)

```js
// wire model (existing, from src/lib/helpers/forms/format.js):
// FormField    = { id, type, label, defaultValue?, options: {…, options?: FormFieldOption[], displayIf?}, vocab?, output? }
// FormFieldOption = { id, label, nextSection? }
// FormSection  = { id, title, description?, questionIds: string[], order? }

// NEW builder-editing marker (Task 1):
// SectionMarker = { id: string, type: 'section', title: string, description?: string }
// A "builder item" is (FormField | SectionMarker), distinguished by item.type === 'section'.
```

---

### Task 1: Pure section-convert helpers (`builder-sections.js`)

**Files:**
- Create: `src/lib/helpers/forms/builder-sections.js`
- Test: `src/lib/__tests__/builder-sections.test.js`

**Interfaces:**
- Produces:
  - `extractSections(items) → { fields: FormField[], sections: FormSection[] }` — `items` is `(FormField | SectionMarker)[]`.
  - `interleaveSections(fields, sections) → (FormField | SectionMarker)[]`.
  - `isSectionMarker(item) → boolean`.
- Consumes: `FormField`/`FormSection`/`SectionMarker` shapes above.

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/builder-sections.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { extractSections, interleaveSections, isSectionMarker } from '$lib/helpers/forms/builder-sections.js';

const field = (id) => ({ id, type: 'text', label: id, options: {} });
const sec = (id, title) => ({ id, type: 'section', title });

describe('extractSections', () => {
  it('groups fields under their preceding section marker', () => {
    const items = [sec('s1', 'Basics'), field('a'), field('b'), sec('s2', 'More'), field('c')];
    const { fields, sections } = extractSections(items);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(sections).toEqual([
      { id: 's1', title: 'Basics', questionIds: ['a', 'b'], order: 0 },
      { id: 's2', title: 'More', questionIds: ['c'], order: 1 }
    ]);
    // section markers are NOT in the returned fields
    expect(fields.some((f) => f.type === 'section')).toBe(false);
  });
  it('leaves leading un-sectioned fields out of any section', () => {
    const items = [field('a'), sec('s1', 'S1'), field('b')];
    const { fields, sections } = extractSections(items);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b']);
    expect(sections).toEqual([{ id: 's1', title: 'S1', questionIds: ['b'], order: 0 }]);
  });
  it('returns empty sections when there are no markers', () => {
    const { fields, sections } = extractSections([field('a'), field('b')]);
    expect(fields.map((f) => f.id)).toEqual(['a', 'b']);
    expect(sections).toEqual([]);
  });
  it('keeps an empty section (marker with no following fields)', () => {
    const { sections } = extractSections([sec('s1', 'Empty'), sec('s2', 'S2'), field('a')]);
    expect(sections).toEqual([
      { id: 's1', title: 'Empty', questionIds: [], order: 0 },
      { id: 's2', title: 'S2', questionIds: ['a'], order: 1 }
    ]);
  });
  it('carries an optional description onto the section', () => {
    const items = [{ id: 's1', type: 'section', title: 'S1', description: 'hi' }, field('a')];
    expect(extractSections(items).sections[0]).toEqual({ id: 's1', title: 'S1', description: 'hi', questionIds: ['a'], order: 0 });
  });
});

describe('interleaveSections', () => {
  it('is the inverse of extractSections (round-trip identity)', () => {
    const items = [field('x'), sec('s1', 'S1'), field('a'), field('b'), sec('s2', 'S2'), field('c')];
    const { fields, sections } = extractSections(items);
    const back = interleaveSections(fields, sections);
    expect(back.map((i) => (i.type === 'section' ? `#${i.id}` : i.id))).toEqual(['x', '#s1', 'a', 'b', '#s2', 'c']);
  });
  it('with no sections returns the fields unchanged', () => {
    const fields = [field('a'), field('b')];
    expect(interleaveSections(fields, [])).toEqual(fields);
  });
  it('appends fields referenced by no section at the front (defensive)', () => {
    const fields = [field('a'), field('b')];
    const sections = [{ id: 's1', title: 'S1', questionIds: ['b'], order: 0 }];
    const items = interleaveSections(fields, sections);
    expect(items.map((i) => (i.type === 'section' ? `#${i.id}` : i.id))).toEqual(['a', '#s1', 'b']);
  });
});

describe('isSectionMarker', () => {
  it('detects section items', () => {
    expect(isSectionMarker(sec('s1', 'S'))).toBe(true);
    expect(isSectionMarker(field('a'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/builder-sections.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/helpers/forms/builder-sections.js`**

```js
/**
 * Convert between the form builder's editing list (fields with interleaved
 * `type:'section'` divider markers) and the wire model (real FormField[] +
 * FormSection[] grouping). Pure — no Svelte, no side effects.
 *
 * @typedef {import('./format.js').FormField} FormField
 * @typedef {import('./format.js').FormSection} FormSection
 * @typedef {{ id: string, type: 'section', title: string, description?: string }} SectionMarker
 */

/** @param {any} item @returns {item is SectionMarker} */
export function isSectionMarker(item) {
  return !!item && item.type === 'section';
}

/**
 * Split an editing list into real fields + section grouping.
 * A section marker owns the non-section fields that follow it until the next
 * marker. Fields before the first marker are un-sectioned (not in any section).
 * @param {(FormField | SectionMarker)[]} items
 * @returns {{ fields: FormField[], sections: FormSection[] }}
 */
export function extractSections(items) {
  /** @type {FormField[]} */
  const fields = [];
  /** @type {FormSection[]} */
  const sections = [];
  /** @type {FormSection | null} */
  let current = null;
  for (const item of items || []) {
    if (isSectionMarker(item)) {
      current = {
        id: item.id,
        title: item.title || '',
        ...(item.description ? { description: item.description } : {}),
        questionIds: [],
        order: sections.length
      };
      sections.push(current);
    } else {
      fields.push(item);
      if (current) current.questionIds.push(item.id);
    }
  }
  return { fields, sections };
}

/**
 * Inverse of extractSections: rebuild the editing list. Un-sectioned fields
 * (referenced by no section) come first, then each section marker followed by
 * its questionId fields, in section order.
 * @param {FormField[]} fields
 * @param {FormSection[]} sections
 * @returns {(FormField | SectionMarker)[]}
 */
export function interleaveSections(fields, sections) {
  const byId = new Map((fields || []).map((f) => [f.id, f]));
  const claimed = new Set((sections || []).flatMap((s) => s.questionIds || []));
  /** @type {(FormField | SectionMarker)[]} */
  const out = [];
  for (const f of fields || []) if (!claimed.has(f.id)) out.push(f);
  const ordered = [...(sections || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const s of ordered) {
    /** @type {SectionMarker} */
    const marker = { id: s.id, type: 'section', title: s.title || '' };
    if (s.description) marker.description = s.description;
    out.push(marker);
    for (const qid of s.questionIds || []) {
      const f = byId.get(qid);
      if (f) out.push(f);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/__tests__/builder-sections.test.js`
Expected: PASS. Then `pnpm run check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/forms/builder-sections.js src/lib/__tests__/builder-sections.test.js
git commit -m "feat(forms): pure section extract/interleave helpers for the builder"
```

---

### Task 2: Sections in FormBuilder (divider UI + publish/load via helpers)

**Files:**
- Modify: `src/lib/components/forms/FormBuilder.svelte`
- Modify: `messages/en.json`, `messages/de.json` (section UI strings)
- Test: `src/lib/components/__tests__/FormBuilder.sections.test.js` (new)

**Interfaces:**
- Consumes: `extractSections`/`interleaveSections`/`isSectionMarker` (Task 1); `generateFieldId` (`$lib/helpers/forms.js`).
- Produces: builder `fields` state may now contain section markers (`type:'section'`); `publish()` splits them out via `extractSections`.

The builder's `FieldState` (FormBuilder.svelte:50-67) and `fields` state (:90-109), `addField` (:127-146), `moveField` (:157-161), publish mapping (:281-307), and the fields render loop (near :424 `{#each fields …}`) are the touch points.

- [ ] **Step 1: Write the failing component test** — `src/lib/components/__tests__/FormBuilder.sections.test.js`. Follow the existing `FormBuilder.test.js` mocking (it mocks accounts/publish/loaders — copy its `vi.mock` header). The test builds a form with a section and asserts the published template's tags carry `settings.sections`.

```js
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
// reuse the exact vi.mock block from FormBuilder.test.js (accounts, publish-service,
// nostr-infrastructure, loaders/base, relay-helper, config) — copy it verbatim here.
import { parseFormTemplate } from '$lib/helpers/forms.js';
import FormBuilder from '$lib/components/forms/FormBuilder.svelte';

// capture what publishEvent receives (the mock from the copied header should expose it)
import { publishEvent } from '$lib/services/publish-service.js';

describe('FormBuilder section authoring', () => {
  it('adds a section, assigns a field, and publishes settings.sections', async () => {
    render(FormBuilder, {});
    // name the form
    await fireEvent.input(screen.getByPlaceholderText(/form name/i), { target: { value: 'My Form' } });
    // add a section, then a text field (which falls under the section)
    await fireEvent.click(screen.getByRole('button', { name: /add section/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'text' }));
    // name the section + field via their inputs (adapt selectors to the actual DOM)
    // … set section title to 'Basics' and the field label to 'Title' …
    await fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    const signed = publishEvent.mock.calls.at(-1)?.[0];
    expect(signed).toBeTruthy();
    const parsed = parseFormTemplate(signed);
    expect(parsed.sections.length).toBe(1);
    expect(parsed.sections[0].title).toBe('Basics');
    expect(parsed.sections[0].questionIds.length).toBe(1);
    // the section marker is NOT a field
    expect(parsed.fields.every((f) => f.type !== 'section')).toBe(true);
  });
});
```

(Adapt selectors to the real DOM once the UI exists — the assertion contract is: a published template has `sections` and no `section`-typed field. If wiring the full publish in jsdom is too heavy given the mock surface, instead export a small pure `buildFormFieldsAndSections(fields)` from FormBuilder's script into a testable helper and assert on it — but prefer the end-to-end publish assertion.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilder.sections.test.js`
Expected: FAIL — no "Add section" button.

- [ ] **Step 3: Extend `FieldState` + add section state helpers**

In `FormBuilder.svelte`: extend the `FieldState` typedef with `@property {string} [title]` and `@property {string} [description]` (used only when `type==='section'`). Import the helpers:

```js
import { extractSections, interleaveSections, isSectionMarker } from '$lib/helpers/forms/builder-sections.js';
```

Add an `addSection()` beside `addField` (:146):

```js
function addSection() {
  const existingIds = fields.map((f) => f.id);
  fields.push({
    id: generateFieldId('section', existingIds),
    type: 'section',
    title: '',
    description: '',
    // unused-for-sections FieldState fields, kept for shape uniformity:
    label: '', defaultValue: '', required: false, placeholder: '',
    min: undefined, max: undefined, selectOptions: [], multiple: false,
    vocab: undefined, output: '', vocabNaddrInput: '', vocabError: ''
  });
}
```

- [ ] **Step 4: Load/fork via `interleaveSections`; publish via `extractSections`**

Replace the `fields` seeding (:90-109) and remove `templateSections` (:113). Seed from an interleaved list:

```js
// map a parsed FormField -> builder FieldState
function fieldToState(f) {
  return {
    id: f.id, type: f.type, label: f.label, defaultValue: f.defaultValue || '',
    required: f.options?.required || false, placeholder: f.options?.placeholder || '',
    min: f.options?.min, max: f.options?.max, selectOptions: f.options?.options || [],
    multiple: f.options?.multiple || false, vocab: f.vocab, output: f.output,
    vocabNaddrInput: vocabToNaddr(f.vocab), vocabError: '', displayIf: f.options?.displayIf
  };
}
function markerToState(m) {
  return { id: m.id, type: 'section', title: m.title || '', description: m.description || '',
    label: '', defaultValue: '', required: false, placeholder: '', min: undefined, max: undefined,
    selectOptions: [], multiple: false, vocab: undefined, output: '', vocabNaddrInput: '', vocabError: '' };
}
let fields = $state(
  existing
    ? interleaveSections(existing.fields, existing.sections || []).map((it) =>
        isSectionMarker(it) ? markerToState(it) : fieldToState(it)
      )
    : []
);
```

In `publish()` (replace :281-307): build items from the FieldState list (section states → SectionMarker, field states → FormField via the existing mapping), then split:

```js
const items = fields.map((f) =>
  f.type === 'section'
    ? { id: f.id, type: 'section', title: f.title || '', ...(f.description ? { description: f.description } : {}) }
    : {
        id: f.id, type: f.type, label: f.label, defaultValue: f.defaultValue,
        options: {
          ...(f.required && { required: true }),
          ...(f.placeholder && { placeholder: f.placeholder }),
          ...(f.min !== undefined && { min: f.min }),
          ...(f.max !== undefined && { max: f.max }),
          ...((f.type === 'select' || f.type === 'radio') && f.selectOptions.length > 0 && { options: f.selectOptions }),
          ...(f.multiple && { multiple: true }),
          ...(f.displayIf ? { displayIf: f.displayIf } : {})
        },
        ...(f.vocab?.address ? { vocab: f.vocab } : {}),
        ...(f.output ? { output: f.output } : {})
      }
);
const { fields: formFields, sections } = extractSections(items);
const tags = buildFormTemplateTags(dTag, formFields, {
  name: formName, description: formDescription, public: isPublic, confirmationMessage,
  ...(forkOf ? { forkOf } : {}),
  ...(sections.length > 0 ? { sections } : {})
});
```

Also update the `loadParentForm` fork mapping (it currently maps `parsed.fields` directly, ~:220-235) to `interleaveSections(parsed.fields, parsed.sections || []).map(...)` the same way.

- [ ] **Step 5: Render section dividers in the field loop**

In the `{#each fields as field, i (field.id + '-' + i)}` block (~:424): when `field.type === 'section'`, render a divider header instead of `FormBuilderFieldRow` — a title input (`bind:value={fields[i].title}`, placeholder `m.form_builder_section_title_placeholder()`), an optional description input (`bind:value={fields[i].description}`), and the SAME drag handle + up/down `moveField` + delete `removeField` controls the field rows use (reuse them — do not reimplement). Keep the `FormBuilderFieldRow` branch for non-section fields.

Add the "Add section" control next to "Add field" (near the `FIELD_TYPES` buttons, ~:476-484):

```svelte
<button class="btn btn-outline btn-sm" onclick={addSection}>{m.form_builder_add_section()}</button>
```

Add Paraglide messages to both catalogs:
```json
"form_builder_add_section": "+ Add section",
"form_builder_section_title_placeholder": "Section title",
"form_builder_section_description_placeholder": "Section description (optional)"
```
(de: `"+ Abschnitt hinzufügen"`, `"Abschnittstitel"`, `"Abschnittsbeschreibung (optional)"`.)

- [ ] **Step 6: Run tests + check**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilder.sections.test.js src/lib/components/__tests__/FormBuilder.test.js` then `pnpm run check` and `pnpm run lint`.
Expected: PASS, 0 errors, clean. (Fix the existing `FormBuilder.test.js` only if it asserted the removed `templateSections` variable — it should not.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/forms/FormBuilder.svelte src/lib/components/__tests__/FormBuilder.sections.test.js messages/
git commit -m "feat(forms): section-divider authoring in FormBuilder (add/reorder/publish sections)"
```

---

### Task 3: field-output on every field type + rich field palette

**Files:**
- Modify: `src/lib/components/forms/FormBuilderFieldRow.svelte`
- Modify: `src/lib/components/forms/FormBuilder.svelte` (`FIELD_TYPES` array)
- Modify: `messages/en.json`, `messages/de.json` (new AMB_OUTPUTS labels + type labels)
- Test: extend `src/lib/components/__tests__/FormBuilderFieldRow.test.js`

**Interfaces:**
- Consumes: the field-type render registry types (`creator`/`amb-relation`/`external-urls`) already exist; this only makes the builder able to ADD them and set output.
- Produces: any field can carry `output`; new palette types produce fields with the right implied output.

- [ ] **Step 1: Write the failing test** — add to `FormBuilderFieldRow.test.js`:

```js
it('shows the output picker for a non-choice text field', () => {
  // render a FieldRow with a text field; the field-output select must be present
  // (previously it only rendered for choice/vocab fields)
  // assert getByTestId('field-output-select') exists for type:'text'
});
it('lists the extended AMB outputs including amb:id and amb:image', () => {
  // the output select options include amb:name, amb:id, amb:image, amb:datePublished, amb:isAccessibleForFree
});
```

(Adapt to the file's existing render helper/wrapper `FormBuilderFieldRowTestWrapper.svelte`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilderFieldRow.test.js`
Expected: FAIL (output select absent for text field).

- [ ] **Step 3: Extend `AMB_OUTPUTS` + move the output picker out of choice-only**

In `FormBuilderFieldRow.svelte`, extend `AMB_OUTPUTS` (:45-68) with the missing slice-1 props (each needs a Paraglide label added to both catalogs):

```js
{ value: 'amb:id', label: () => m.form_builder_field_output_amb_id() },
{ value: 'amb:image', label: () => m.form_builder_field_output_amb_image() },
{ value: 'amb:datePublished', label: () => m.form_builder_field_output_amb_datePublished() },
{ value: 'amb:dateCreated', label: () => m.form_builder_field_output_amb_dateCreated() },
{ value: 'amb:isAccessibleForFree', label: () => m.form_builder_field_output_amb_isAccessibleForFree() },
{ value: 'amb:creator', label: () => m.form_builder_field_output_amb_creator() },
{ value: 'amb:hasPart', label: () => m.form_builder_field_output_amb_hasPart() },
{ value: 'amb:isPartOf', label: () => m.form_builder_field_output_amb_isPartOf() },
{ value: 'amb:refs', label: () => m.form_builder_field_output_amb_refs() }
```

The output `<select>` currently lives inside the `fieldMode === 'vocab'` block (~:426-440). Extract it into a small always-rendered "Output" row shown for EVERY field type (place it after the label/required row, before the choice/vocab-specific config). Keep the vocab-mode block's output select removed (don't render it twice). The select keeps its `data-testid="field-output-select"`, its auto default, the `AMB_OUTPUTS` options, and the `ext` option.

- [ ] **Step 4: Add rich types to the palette + implied output**

In `FormBuilder.svelte` `FIELD_TYPES` (:19-30) append `'creator'`, `'amb-relation'`, `'external-urls'`. In `addField(type)`, set the implied output for these so the user needn't pick it:

```js
const impliedOutput = { creator: 'amb:creator', 'external-urls': 'amb:refs' };
// … inside the pushed object: output: impliedOutput[type] || '',
```

In `FormBuilderFieldRow.svelte`, for these three types render ONLY the label + required + output rows (no manual-options/vocab/min-max UI — they render via their adapters). For `amb-relation`, the output row should offer `amb:hasPart` / `amb:isPartOf` (a meaningful choice); for `creator`/`external-urls` show the locked implied output (read-only text or a disabled select showing the value). Gate the existing choice/number/vocab config blocks behind `!isRichType` where `const RICH_TYPES = ['creator','amb-relation','external-urls']; const isRichType = $derived(RICH_TYPES.includes(field.type));`.

- [ ] **Step 5: Run tests + check + commit**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilderFieldRow.test.js src/lib/components/__tests__/FormBuilder.test.js` then `pnpm run check`, `pnpm run lint`.
Expected: PASS, 0 errors, clean.

```bash
git add src/lib/components/forms/FormBuilderFieldRow.svelte src/lib/components/forms/FormBuilder.svelte messages/ src/lib/components/__tests__/
git commit -m "feat(forms): field-output on every field type + creator/relation/external-urls in palette"
```

---

### Task 4: amb-basic sections + reachability

**Files:**
- Modify: `scripts/data/edufeed-forms.json` (`amb-basic` gets a `sections` array)
- Modify: `scripts/lib/__tests__/publish-forms-build.amb.test.mjs` (assert sections round-trip)
- Modify: `.superpowers/sdd/operator-notes.md` (activation step — this file is gitignored scratch, so also note the activation in the plan report)

**Interfaces:**
- Consumes: `buildFormTemplate` already passes `sections` through (Phase-1b Task 6); `parseFormTemplate` reads them.

- [ ] **Step 1: Write the failing test** — extend `publish-forms-build.amb.test.mjs`:

```js
it('groups amb-basic fields into sections that round-trip', () => {
  const tags = buildFormTemplate(amb); // amb = the amb-basic entry
  const parsed = parseFormTemplate({ kind: 30168, pubkey: 'pk', content: '', created_at: 0, tags });
  expect(parsed.sections.length).toBeGreaterThanOrEqual(3);
  // every field id referenced by a section exists among the parsed fields
  const fieldIds = new Set(parsed.fields.map((f) => f.id));
  for (const s of parsed.sections) for (const q of s.questionIds) expect(fieldIds.has(q)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run scripts/lib/__tests__/publish-forms-build.amb.test.mjs`
Expected: FAIL — amb-basic has no sections.

- [ ] **Step 3: Add `sections` to the `amb-basic` entry** in `scripts/data/edufeed-forms.json`, grouping its 16 field ids:

```json
"sections": [
  { "id": "sec-basics", "title": "Grunddaten", "questionIds": ["name", "description", "url", "inLanguage", "image", "datePublished"], "order": 0 },
  { "id": "sec-classification", "title": "Einordnung", "questionIds": ["about", "learningResourceType", "educationalLevel", "keywords"], "order": 1 },
  { "id": "sec-rights", "title": "Rechte", "questionIds": ["license", "isAccessibleForFree"], "order": 2 },
  { "id": "sec-content", "title": "Inhalt & Urheber", "questionIds": ["creators", "externalUrls"], "order": 3 },
  { "id": "sec-relations", "title": "Beziehungen", "questionIds": ["hasPart", "isPartOf"], "order": 4 }
]
```

Match the exact field `id`s present in the amb-basic entry (read the JSON first; adjust ids if they differ). Ensure `buildFormTemplate` passes `form.sections` — Phase-1b already wired `buildFormTemplateTags(form.d, fields, { name, description, sections: form.sections })`; confirm and, if missing, add it.

- [ ] **Step 4: Run test; document activation**

Run: `pnpm vitest run scripts/lib/__tests__/publish-forms-build.amb.test.mjs` → PASS. Then `pnpm run check`.

Append to the operator notes + your task report: activation is a deployment step — publish `amb-basic` (`node scripts/publish-edufeed-forms.mjs` with the publish key), take the resulting naddr, set `RESOURCE_FORM_TEMPLATE_NADDR_AMB=<naddr>` in the deployment `.env`; then `/create/resource/amb` routes to the sectioned template form. No app code depends on it being set (the wizard remains the default).

- [ ] **Step 5: Commit**

```bash
git add scripts/data/edufeed-forms.json scripts/lib/__tests__/publish-forms-build.amb.test.mjs
git commit -m "feat(forms): section grouping for the amb-basic template"
```

--- 4a complete (sections + output + palette + reachability). 4b below adds branching UI. ---

### Task 5: Option → section routing UI

**Files:**
- Modify: `src/lib/components/forms/FormBuilderFieldRow.svelte` (manual-options editor)
- Test: extend `src/lib/components/__tests__/FormBuilderFieldRow.test.js`

**Interfaces:**
- Consumes: the form's section list (thread `sections` down as a prop from `FormBuilder` → `FormBuilderFieldRow`); `FormFieldOption.nextSection` (serialized by `format.js`).
- Produces: choice-field options can carry `nextSection`.

- [ ] **Step 1: Thread sections into the row** — in `FormBuilder.svelte`'s `<FormBuilderFieldRow>` usage (~:456), pass `sections={fields.filter((f) => f.type === 'section').map((f) => ({ id: f.id, title: f.title }))}`. Add a `sections = []` prop to `FormBuilderFieldRow`'s `$props()`.

- [ ] **Step 2: Write the failing test** — add to `FormBuilderFieldRow.test.js`: render a `radio` field with two options and a non-empty `sections` prop; assert each option row has a "→ section" select; selecting a section sets `option.nextSection` on the bound field. (Adapt to the wrapper; assert on the bound `field.selectOptions[i].nextSection`.)

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run src/lib/components/__tests__/FormBuilderFieldRow.test.js` → FAIL.

- [ ] **Step 4: Implement** — in the manual-options editor (the `{#each field.selectOptions as opt, j …}` block, ~:316-352), after each option's label, add a routing select when `sections.length > 0`:

```svelte
{#if sections.length > 0}
  <select
    class="select-bordered select select-xs"
    value={opt.nextSection || ''}
    onchange={(e) => (field.selectOptions[j] = { ...opt, nextSection: e.currentTarget.value || undefined })}
    aria-label={m.form_builder_option_route_label()}
  >
    <option value="">{m.form_builder_option_route_none()}</option>
    {#each sections as s (s.id)}
      <option value={s.id}>{s.title || s.id}</option>
    {/each}
  </select>
{/if}
```

Add messages `form_builder_option_route_label` ("Go to section"), `form_builder_option_route_none` ("— continue —") to both catalogs.

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilderFieldRow.test.js` + `pnpm run check` + `pnpm run lint`.

```bash
git add src/lib/components/forms/FormBuilderFieldRow.svelte src/lib/components/forms/FormBuilder.svelte messages/ src/lib/components/__tests__/
git commit -m "feat(forms): option→section routing authoring in the builder"
```

---

### Task 6: Single-condition displayIf ("Show only if…") UI

**Files:**
- Create: `src/lib/components/forms/FormBuilderConditionRow.svelte`
- Modify: `src/lib/components/forms/FormBuilderFieldRow.svelte` (render the condition row), `FormBuilder.svelte` (thread earlier fields down)
- Modify: `messages/en.json`, `messages/de.json`
- Test: `src/lib/components/__tests__/FormBuilderConditionRow.test.js` (new)

**Interfaces:**
- Consumes: the list of *earlier* fields (`{ id, label, type, selectOptions }`) threaded from `FormBuilder` (fields before this one, excluding sections); writes `field.displayIf = { rules: [{ questionId, operator, value }] }`.
- Produces: `field.options.displayIf` on publish (already mapped in Task 2's publish block via `f.displayIf`).

- [ ] **Step 1: Write the failing test** — `FormBuilderConditionRow.test.js`: render with `availableQuestions=[{id:'kind',label:'Kind',type:'radio',selectOptions:[{id:'a',label:'A'},{id:'b',label:'B'}]}]` and a bindable `value` (the displayIf object). Selecting question `kind`, operator `equals`, value option `a` → `value === { rules: [{ questionId: 'kind', operator: 'equals', value: 'a' }] }`. Clearing the question → `value` becomes `undefined`. Assert the value dropdown lists the referenced question's OPTION IDS (a/b), and stores the id (not label).

- [ ] **Step 2: Run to verify it fails** — FAIL (component missing).

- [ ] **Step 3: Implement `FormBuilderConditionRow.svelte`**:

```svelte
<script>
  import * as m from '$lib/paraglide/messages';
  /** @type {{ value: any, availableQuestions: {id:string,label:string,type:string,selectOptions?:{id:string,label:string}[]}[], onchange: (v:any)=>void }} */
  let { value = undefined, availableQuestions = [], onchange } = $props();

  const rule = $derived(value?.rules?.[0] || {});
  const referenced = $derived(availableQuestions.find((q) => q.id === rule.questionId));
  const isChoice = $derived(!!referenced?.selectOptions?.length);

  function update(patch) {
    const next = { ...rule, ...patch };
    if (!next.questionId) return onchange(undefined); // cleared
    onchange({ rules: [{ questionId: next.questionId, operator: next.operator || 'equals', value: next.value ?? '' }] });
  }
</script>

<div class="flex flex-wrap items-center gap-2 text-sm">
  <span class="text-xs text-base-content/50">{m.form_builder_showif_label()}</span>
  <select class="select-bordered select select-xs" value={rule.questionId || ''} onchange={(e) => update({ questionId: e.currentTarget.value, value: '' })}>
    <option value="">{m.form_builder_showif_always()}</option>
    {#each availableQuestions as q (q.id)}<option value={q.id}>{q.label || q.id}</option>{/each}
  </select>
  {#if rule.questionId}
    <select class="select-bordered select select-xs" value={rule.operator || 'equals'} onchange={(e) => update({ operator: e.currentTarget.value })}>
      <option value="equals">{m.form_builder_showif_equals()}</option>
      <option value="notEquals">{m.form_builder_showif_notEquals()}</option>
      <option value="contains">{m.form_builder_showif_contains()}</option>
    </select>
    {#if isChoice}
      <select class="select-bordered select select-xs" value={rule.value || ''} onchange={(e) => update({ value: e.currentTarget.value })}>
        <option value="">—</option>
        {#each referenced.selectOptions as o (o.id)}<option value={o.id}>{o.label || o.id}</option>{/each}
      </select>
    {:else}
      <input class="input-bordered input input-xs" value={rule.value || ''} oninput={(e) => update({ value: e.currentTarget.value })} />
    {/if}
  {/if}
</div>
```

Add messages: `form_builder_showif_label` ("Show only if"), `form_builder_showif_always` ("always"), `form_builder_showif_equals`/`_notEquals`/`_contains` ("equals"/"is not"/"contains") to both catalogs.

- [ ] **Step 4: Wire into `FormBuilderFieldRow`** — render `<FormBuilderConditionRow value={field.displayIf} availableQuestions={earlierQuestions} onchange={(v) => (field.displayIf = v)} />` for every non-section field. Thread `earlierQuestions` from `FormBuilder`: for the row at index `i`, pass the non-section fields before `i` shaped `{ id, label, type, selectOptions }`.

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run src/lib/components/__tests__/FormBuilderConditionRow.test.js src/lib/components/__tests__/FormBuilderFieldRow.test.js` + `pnpm run check` + `pnpm run lint`.

```bash
git add src/lib/components/forms/FormBuilderConditionRow.svelte src/lib/components/forms/FormBuilderFieldRow.svelte src/lib/components/forms/FormBuilder.svelte messages/ src/lib/components/__tests__/
git commit -m "feat(forms): single-condition show-if (displayIf) authoring in the builder"
```

---

### Task 7: E2E + full verification

**Files:**
- Create: `e2e/form-builder-authoring.test.js`; modify `e2e/COVERAGE.md`
- Test: full targeted suite + check + lint + full suite

- [ ] **Step 1: Write the E2E** — `e2e/form-builder-authoring.test.js` following existing `e2e/` patterns (auth fixture + a relay seed helper if present). Flow: in `/forms/new`, name a form; add Section A, a `radio` field in it with two options where option 1 routes to Section B; add Section B with a text field that has "show only if [radio] equals [option1]"; publish; open the published form's fill route (`/forms/<naddr>/respond` or `/create-resource`); assert Section A renders first, choosing option 1 advances to Section B, and the show-if field appears only under its condition. If full publish/relay round-trip is unobservable in the harness (as in slice 1), scope to building + publishing + asserting the built template tags (sections + option nextSection + displayIf present) and mark the fill-navigation assertion `test.fixme` with a note — do NOT fake a pass; document in COVERAGE.md.

- [ ] **Step 2: Update `e2e/COVERAGE.md`** — add a row for builder authoring (sections/routing/show-if) noting what's covered and any harness limitation.

- [ ] **Step 3: Full verification**, in order:
  1. `pnpm vitest run src/lib/__tests__/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/ scripts/lib/__tests__/` — PASS.
  2. `pnpm run check` — 0 errors.
  3. `pnpm run lint` — clean.
  4. `pnpm test` (full, once) — PASS modulo the documented pre-existing flakes (inbox/DM parallel, GlobalFAB teardown race). Anything else failing that traces to this phase's code must be fixed; if a form-rendering test collection breaks from a new import, complete its loader mocks (precedent: c640a759).

- [ ] **Step 4: Manual smoke** (use the `verify` skill): log in with a test key, build a 2-section form with a routing option + a show-if field in `/forms/new`, publish, open its fill form, confirm the steps + conditional visibility behave. Capture evidence.

- [ ] **Step 5: Commit**

```bash
git add e2e/form-builder-authoring.test.js e2e/COVERAGE.md
git commit -m "test(e2e): form-builder sections + routing + show-if authoring"
```

---

## Out of scope (later)

Community-admin scoping (h-tag + profile-list), full AND/OR rule-tree conditions UI, Slice-2 composite fields (image+license, curriculum, EKW/Konfi, enrichment, drafts, community share, wizard-fidelity edit), library extraction, and the publish-reliability trio carried from slice 1.

## Self-review notes

- **Spec coverage:** sections authoring (T1 helpers + T2 UI); minimal branching — option routing (T5) + single-condition displayIf (T6); field-output on all types + rich palette (T3); reachability (T4); testing incl. pure-helper unit tests (T1), component tests (T2/T3/T5/T6), E2E (T7). All spec sections mapped.
- **KISS/DRY:** sections reuse the existing field-list machinery (one list, pure convert helpers) — no parallel state; the condition row is one small reusable component; output picker is moved, not duplicated.
- **Type consistency:** `extractSections`/`interleaveSections`/`isSectionMarker`, `SectionMarker`, `FormSection.questionIds`/`order`, `FormFieldOption.nextSection`, and `field.displayIf = { rules: [{questionId, operator, value}] }` are used identically across tasks and match `format.js`/`branching.js`.
- **Backward compat:** zero-section forms publish with no `sections` tag (T1 test); no-displayIf fields carry no `displayIf` (existing passthrough); the wizard remains the default route (T4).
