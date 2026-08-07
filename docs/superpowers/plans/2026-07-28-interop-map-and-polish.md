# renderElement Interop Map + Builder Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make foreign (Formstr) forms render with rich widgets in our app via a `renderElement` synonym map, and apply the Phase-2 final-review cleanups.

**Architecture:** A small synonym map normalizes foreign `renderElement` names to our canonical field-type vocabulary at parse time (`parseFormTemplate`), so branching/rendering see one vocabulary; our own vocab passes through unchanged. The polish items are localized reviewer-identified cleanups.

**Tech Stack:** SvelteKit + Svelte 5, JSDoc, Vitest. No new deps.

**Context:** Bidirectional NIP-101 interop with `@formstr/sdk` is confirmed (see memory `formstr-interop-verified`); the one gap is that Formstr's `renderElement` vocabulary (`shortText`/`longText`/`radioButton`/`checkboxes`/`dropdown`) differs from ours (`text`/`textarea`/`radio`/`checkbox`/`select`), so foreign forms currently degrade to text inputs. The final whole-branch review flagged four cosmetic cleanups.

## Global Constraints

- Worktree `/home/laoc/coding/edufeed/edufeed-app/.claude/worktrees/nip101-forms-alignment`, branch `feature/nostr-metadata-forms`. Never the main-checkout path.
- pnpm; node-env tests `/** @vitest-environment node */`. `pnpm run check` 0 errors + `pnpm run lint` clean after every task.
- Our own renderElement values (`text`/`textarea`/`radio`/`checkbox`/`select`/`number`/`date`/`text-array`/`creator`/`amb-relation`/`external-urls`) MUST pass through the synonym map unchanged (only foreign names are rewritten).
- `docs/` gitignored — `git add -f`. i18n: no `@` before `{param}`, both catalogs.
- Do NOT run the full `pnpm test` suite while iterating; targeted files per task, full suite in the last task.

---

### Task 1: renderElement synonym map

**Files:**
- Modify: `src/lib/helpers/forms/format.js` (add `RENDER_ELEMENT_SYNONYMS` + apply in `parseFormTemplate`)
- Test: `src/lib/__tests__/forms.render-synonyms.test.js` (new); update `src/lib/__tests__/forms.interop.test.js`

**Interfaces:**
- Produces: `normalizeRenderElement(name) → string` (exported); `parseFormTemplate` now yields our-vocabulary `field.type` for foreign forms.

- [ ] **Step 1: Write the failing test** — `src/lib/__tests__/forms.render-synonyms.test.js`:

```js
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseFormTemplate, normalizeRenderElement } from '$lib/helpers/forms/format.js';

const evt = (fieldTags) => ({ kind: 30168, pubkey: 'pk', content: '', created_at: 0,
  tags: [['d', 'x'], ['name', 'F'], ['settings', '{}'], ...fieldTags] });

describe('normalizeRenderElement', () => {
  it('maps Formstr names to ours', () => {
    expect(normalizeRenderElement('shortText')).toBe('text');
    expect(normalizeRenderElement('longText')).toBe('textarea');
    expect(normalizeRenderElement('radioButton')).toBe('radio');
    expect(normalizeRenderElement('dropdown')).toBe('select');
    expect(normalizeRenderElement('number')).toBe('number');
    expect(normalizeRenderElement('label')).toBe('label');
  });
  it('passes our own vocabulary through unchanged', () => {
    for (const t of ['text','textarea','radio','checkbox','select','date','text-array','creator','amb-relation','external-urls'])
      expect(normalizeRenderElement(t)).toBe(t);
  });
  it('leaves an unknown name as-is (degrades to text downstream)', () => {
    expect(normalizeRenderElement('holo9000')).toBe('holo9000');
  });
});

describe('parseFormTemplate normalizes foreign renderElement', () => {
  it('a Formstr shortText field parses as type text', () => {
    const p = parseFormTemplate(evt([['field', 'q1', 'text', 'Name?', '[]', JSON.stringify({ renderElement: 'shortText' })]]));
    expect(p.fields[0].type).toBe('text');
  });
  it('a Formstr radioButton field parses as type radio', () => {
    const p = parseFormTemplate(evt([['field', 'q2', 'option', 'Pick', JSON.stringify([['a','A']]), JSON.stringify({ renderElement: 'radioButton' })]]));
    expect(p.fields[0].type).toBe('radio');
  });
  it('a Formstr checkboxes field parses as select with multiple=true', () => {
    const p = parseFormTemplate(evt([['field', 'q3', 'option', 'Many', JSON.stringify([['a','A'],['b','B']]), JSON.stringify({ renderElement: 'checkboxes' })]]));
    expect(p.fields[0].type).toBe('select');
    expect(p.fields[0].options.multiple).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`pnpm vitest run src/lib/__tests__/forms.render-synonyms.test.js`) — normalizeRenderElement not exported.

- [ ] **Step 3: Implement** in `format.js`:

```js
/**
 * Foreign renderElement vocabulary (Formstr et al.) → our canonical field types.
 * Our own type names are absent here and pass through unchanged; unknown names
 * pass through too (FieldsRenderer degrades them to a text input, per NIP-101).
 * `checkboxes` is Formstr's MULTI-select choice → our `select` with multiple=true
 * (NOT our boolean `checkbox`); handled specially in parseFormTemplate.
 */
export const RENDER_ELEMENT_SYNONYMS = {
  shortText: 'text',
  longText: 'textarea',
  paragraph: 'textarea',
  radioButton: 'radio',
  dropdown: 'select',
  checkboxes: 'select' // + multiple=true, applied in parseFormTemplate
};

/** @param {string} name @returns {string} */
export function normalizeRenderElement(name) {
  return RENDER_ELEMENT_SYNONYMS[name] || name;
}
```

In `parseFormTemplate`, where a field's `type` is derived from `renderElement` (the NIP-101 branch, `type: renderElement || (t[2] === 'option' ? 'select' : 'text')`), wrap it: `type: normalizeRenderElement(renderElement || (t[2] === 'option' ? 'select' : 'text'))`. Immediately after building the field object, apply the `checkboxes` special case: if the original `renderElement === 'checkboxes'`, set `opts.multiple = true` on that field's options. (Apply in BOTH the NIP-101 path and, for symmetry, the legacy path if it reads renderElement — check; the legacy path uses `t[2]` directly, so only the NIP-101 path needs it.)

- [ ] **Step 4: Run — PASS.** Then update `src/lib/__tests__/forms.interop.test.js`: the existing NIP-101-spec-example test asserts `p.fields[1].type === 'select'` for an `option` field with no renderElement — that stays. Add one assertion there that a `renderElement: 'radioButton'` field on the spec example would parse as `radio` (or add a small case). Keep all existing interop assertions green.

- [ ] **Step 5: `pnpm run check` 0 errors; commit**

```bash
git add src/lib/helpers/forms/format.js src/lib/__tests__/forms.render-synonyms.test.js src/lib/__tests__/forms.interop.test.js
git commit -m "feat(forms): renderElement synonym map so foreign (Formstr) forms render with rich widgets"
```

---

### Task 2: Final-review polish cleanups

**Files:**
- Modify: `src/lib/components/forms/FormBuilder.svelte` (hoist locked-output const; make `sections`/`earlierQuestions` `$derived` where they're computed inline)
- Modify: `src/lib/components/forms/FormBuilderFieldRow.svelte` (gate the option-routing select to `select`/`radio`, not `checkbox`)
- Modify: `src/lib/components/forms/FormBuilderConditionRow.svelte` (hide the row when there are no earlier questions)
- Test: extend `src/lib/components/forms/__tests__/` (FieldsRenderer/FormBuilder/ConditionRow tests as touched) and `src/lib/components/__tests__/`

**Interfaces:** none new — behavior refinements.

- [ ] **Step 1: Hoist duplicated locked-output map.** `IMPLIED_OUTPUT` (FormBuilder) and `LOCKED_OUTPUT` (FormBuilder) and `LOCKED_OUTPUTS` (FormBuilderFieldRow) are three copies of `{ creator: 'amb:creator', 'external-urls': 'amb:refs' }`. Add `export const LOCKED_FIELD_OUTPUTS = { creator: 'amb:creator', 'external-urls': 'amb:refs' };` to a shared pure module — put it in `src/lib/helpers/forms/builder-sections.js` (already the builder's pure helper home) or a new `src/lib/config/form-field-types.js` export; import it in both components and delete the three literals. No behavior change; existing tests stay green (`pnpm vitest run src/lib/components/__tests__/FormBuilder.test.js src/lib/components/__tests__/FormBuilderFieldRow.test.js`).

- [ ] **Step 2: Gate option-routing to select/radio.** In `FormBuilderFieldRow.svelte`, the routing `<select>` currently shows for all choice types (incl. `checkbox`). Change its guard from `sections.length > 0` to `sections.length > 0 && (field.type === 'select' || field.type === 'radio')`. Add a test: a `checkbox` field with sections shows NO routing select; a `radio` field does. (`pnpm vitest run src/lib/components/__tests__/FormBuilderFieldRow.test.js`.)

- [ ] **Step 3: Hide show-if row with no earlier questions.** In `FormBuilderConditionRow.svelte` (or its call site in FormBuilderFieldRow), render nothing when `availableQuestions.length === 0`. Add/adjust a test: the first field's row shows no "Show only if" control; a later field's does. (`pnpm vitest run src/lib/components/__tests__/FormBuilderConditionRow.test.js`.)

- [ ] **Step 4: `$derived` the inline props.** In `FormBuilder.svelte`, the `sections={fields.filter(...)}` and `earlierQuestions={fields.slice(0,i).filter(...)}` computed inline in the `{#each}` — leave `earlierQuestions` inline (it depends on loop index `i`, can't hoist), but hoist the sections list to `const builderSections = $derived(fields.filter((f) => f.type === 'section').map((f) => ({ id: f.id, title: f.title })));` and pass `sections={builderSections}`. Cosmetic; tests stay green.

- [ ] **Step 5: `pnpm run check` + `pnpm run lint`; commit**

```bash
git add src/lib/components/forms/ src/lib/helpers/forms/ src/lib/config/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/
git commit -m "refactor(forms): hoist locked-output const, gate routing to select/radio, hide empty show-if row"
```

---

### Task 3: Strengthen the E2E + full verification

**Files:**
- Modify: `e2e/form-builder-authoring.test.js` (3rd section so routing diverges from linear order)
- Test: full targeted suite + check + lint + full suite

- [ ] **Step 1: Strengthen routing assertion.** The E2E currently has 2 sections, so an explicit route (Red→B) is indistinguishable from linear fallthrough (Blue→next=B). Add a **third** section C and route the "Red" option to **Section C** while linear order would go A→B. Assert that choosing Red advances to Section C (skipping B) — this makes the routing check non-tautological. Also (if the harness supports it) keep the displayIf show/hide assertions. If full E2E can't run in this environment, keep the change and note it; do not fake a pass.

- [ ] **Step 2: Full verification**, in order:
  1. `pnpm vitest run src/lib/__tests__/ src/lib/components/__tests__/ src/lib/components/forms/__tests__/ scripts/lib/__tests__/` — PASS.
  2. `pnpm run check` — 0 errors.
  3. `pnpm run lint` — clean.
  4. `pnpm test` (full, once) — PASS modulo documented pre-existing flakes (inbox/DM parallel, GlobalFAB teardown race). Anything else tracing to this change must be fixed.
  5. If the E2E harness (nix + docker relay) is available, run `pnpm run test:e2e` for `form-builder-authoring.test.js` and report the result.

- [ ] **Step 3: Commit**

```bash
git add e2e/form-builder-authoring.test.js
git commit -m "test(e2e): 3-section topology so routing is distinguishable from linear order"
```

---

## Out of scope

AMB-serializer convergence (its own project after — see memory `amb-serializer-convergence-plan`), Slice-2 composite fields, amb-basic reachability wiring, and the branch merge.

## Self-review notes

- Spec coverage: synonym map (T1) closes the interop `renderElement` gap; T2 applies all four final-review cleanups; T3 strengthens the E2E routing check. Type consistency: `normalizeRenderElement`/`RENDER_ELEMENT_SYNONYMS`/`LOCKED_FIELD_OUTPUTS` used consistently. Backward compat: our own vocab passes through the synonym map unchanged (explicit test); the `checkboxes→select+multiple` special case is the one semantic mapping, tested.
