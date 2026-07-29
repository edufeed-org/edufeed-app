/**
 * E2E test for the form-builder authoring flow: section-divider authoring,
 * option→section routing, and single-condition displayIf ("show only if"),
 * see `FormBuilder.svelte` / `FormBuilderFieldRow.svelte` /
 * `FormBuilderConditionRow.svelte` and the pure helpers in
 * `src/lib/helpers/forms/builder-sections.js` + `branching.js`.
 *
 * Unlike `amb-basic-form.test.js` test 2 (which needs to read a *published*
 * kind-30142 resource back off the AMB relay via a fresh raw WebSocket to
 * prove NIP-AMB tag compliance — a genuine relay round-trip that this
 * sandbox could not observe under load), this spec never needs to prove the
 * kind-30168 template actually *persisted* on the relay. It only needs to
 * prove the builder UI produces a template whose `sections` / option
 * `nextSection` / `displayIf` are then correctly interpreted by the fill
 * wizard (`FormRenderer.svelte`) for the SAME logged-in user who just built
 * it. `FormBuilder.publish()` calls `eventStore.add(signed)` (optimistic
 * local write — the same pattern `TemplateResourceForm.handleSubmit` uses,
 * see `amb-basic-form.test.js`'s limitation note in COVERAGE.md)
 * *before* it navigates, and every navigation in this test is a same-tab,
 * same-origin SvelteKit `<a>`/`goto()` client-side transition (never a hard
 * `page.goto()` reload), so the app's own in-memory `eventStore` singleton
 * is never dropped. The fill route's `$effect` therefore resolves the
 * template instantly off local state, with no dependency on relay publish
 * timing. This makes the full build → publish → fill-wizard flow reliably
 * observable, so — unlike the `amb-basic-form.test.js` precedent — nothing
 * here is scoped down to a tags-only assertion or marked `test.fixme`.
 *
 * Flow: build a **3-section** form (Section A: radio field "Color" with two
 * options, "Red" routed explicitly to Section C — skipping Section B, which
 * is where linear order would otherwise land next; Section B: a plain text
 * field "Note" with no condition, just to prove it's reachable by linear
 * fallthrough; Section C: a text field "Reason", shown only if Color equals
 * Red) in `/forms/new`, publish, follow the in-app "Fill Form" link, and
 * drive the wizard both ways:
 *
 * - picking "Blue" (no explicit route → falls through linearly A→B→C) proves
 *   plain linear fallthrough still works, and that "Reason" stays hidden on
 *   Section C when Color isn't Red (show-if false) even though the section
 *   that owns the field HAS been reached;
 * - picking "Red" (explicit option→section route) proves routing overrides
 *   linear order: with 3 sections, linear fallthrough from A would go to B
 *   next, so landing directly on Section C — skipping B — is only
 *   explainable by the route, not by fallthrough. (With only 2 sections, an
 *   explicit route to "the next section" is indistinguishable from
 *   fallthrough; the 3rd section is what makes this a real routing proof.)
 *   The show-if condition is also true here, so "Reason" renders.
 */
import { test, expect } from './fixtures.js';

const RUN_ID = Date.now();

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 */
function fieldRow(page, index) {
  return page.locator('[role="listitem"][data-item-type="field"]').nth(index);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 */
function sectionRow(page, index) {
  return page.locator('[role="listitem"][data-item-type="section"]').nth(index);
}

test.describe('Form builder: sections + option routing + show-if (E2E)', () => {
  test('builds a 3-section form where an explicit route diverges from linear order, and the fill wizard obeys both routing and show-if', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(120000);

    await page.goto('/forms/new');
    const nameInput = page.getByPlaceholder(/Form name/i);
    await expect(nameInput).toBeVisible({ timeout: 15000 });

    const formName = `E2E Sections Form ${RUN_ID}`;
    await nameInput.fill(formName);

    // Public responses — avoids the NIP-44 encryption gate on /respond so
    // this spec doesn't depend on the test signer's NIP-44 support.
    await page.getByLabel('Public responses').check();

    // --- Section A ---
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 0).getByPlaceholder('Section title').fill('Section A');

    // Radio field "Color" with manual options Red/Blue.
    await page.getByRole('button', { name: 'radio', exact: true }).click();
    const colorRow = fieldRow(page, 0);
    const colorLabelInput = colorRow.getByPlaceholder('Enter field name');
    await colorLabelInput.fill('Color');
    await colorLabelInput.blur();
    await colorRow.getByRole('button', { name: 'Add options manually' }).click();
    const newOptionInput = colorRow.getByPlaceholder('New option');
    await newOptionInput.fill('Red');
    await newOptionInput.press('Enter');
    await newOptionInput.fill('Blue');
    await newOptionInput.press('Enter');

    // --- Section B — reached only by linear fallthrough (no option ever
    // routes here explicitly). A plain, unconditional text field just to
    // prove the section is actually rendered when reached.
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 1).getByPlaceholder('Section title').fill('Section B');
    await page.getByRole('button', { name: 'text', exact: true }).click();
    const noteRow = fieldRow(page, 1);
    const noteLabelInput = noteRow.getByPlaceholder('Enter field name');
    await noteLabelInput.fill('Note');
    await noteLabelInput.blur();

    // --- Section C — routed to explicitly from "Red" (skipping Section B).
    // Text field "Reason" (falls after the Section C marker → belongs to
    // Section C), shown only if Color equals Red.
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 2).getByPlaceholder('Section title').fill('Section C');
    await page.getByRole('button', { name: 'text', exact: true }).click();
    const reasonRow = fieldRow(page, 2);
    const reasonLabelInput = reasonRow.getByPlaceholder('Enter field name');
    await reasonLabelInput.fill('Reason');
    await reasonLabelInput.blur();

    // FormBuilderConditionRow's root div is the only one in this row with
    // this exact 4-class combo (the output-picker row lacks `flex-wrap`).
    const conditionRow = reasonRow.locator('div.flex-wrap.items-center.gap-2.text-sm');
    await conditionRow.locator('select').nth(0).selectOption({ label: 'Color' });
    // Operator defaults to "equals" — leave as-is.
    await conditionRow.locator('select').nth(2).selectOption({ label: 'Red' });

    // Route option "Red" → Section C (only appears once ≥1 section exists,
    // and now all three sections are available in its dropdown). Linear
    // order would put "Red" into Section B next, same as "Blue" — this
    // explicit route is what makes the routing proof below non-tautological.
    const redBadge = colorRow.locator('.badge', { hasText: 'Red' });
    await redBadge.locator('select').selectOption({ label: 'Section C' });

    // --- Publish ---
    await page.getByRole('button', { name: 'Publish Form', exact: true }).click();
    await page.waitForURL(/\/forms\/naddr1[a-z0-9]+\/?$/i, { timeout: 20000 });

    // Follow the in-app "Fill Form" link (client-side nav — keeps the
    // in-memory eventStore populated from the optimistic publish() write,
    // see file header).
    await page.getByRole('link', { name: 'Fill Form', exact: true }).click();
    await page.waitForURL(/\/forms\/naddr1[a-z0-9]+\/respond\/?$/i, { timeout: 20000 });

    // Section A renders first.
    await expect(page.getByRole('heading', { name: 'Section A' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.getByLabel('Red')).toBeVisible();
    await expect(page.getByLabel('Blue')).toBeVisible();
    // Neither Section B's nor Section C's field is rendered yet.
    await expect(page.locator('#note')).toHaveCount(0);
    await expect(page.locator('#reason')).toHaveCount(0);

    // Pick "Blue" (no explicit route → falls through to Section B by
    // linear order).
    await page.getByLabel('Blue').check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section B' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.locator('#note')).toBeVisible();
    // Reason belongs to Section C — not reached yet.
    await expect(page.locator('#reason')).toHaveCount(0);

    // Keep going linearly, B → C (no route on "Note"). Color is still
    // "Blue", so the show-if condition (Color equals Red) is false: "Reason"
    // must stay hidden even though Section C — the section that owns it —
    // has now actually been reached.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section C' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.locator('#reason')).toHaveCount(0);

    // Back twice: C → B → A.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section B' })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section A' })).toBeVisible();

    // Pick "Red" — the explicit option→section route fires: Section C is
    // reached DIRECTLY, skipping Section B. This is the non-tautological
    // routing proof: with 3 sections, linear order would have advanced to B
    // next (as it just did for "Blue"), so landing on Section C here can
    // only be explained by the route. The show-if condition is now also
    // true, so "Reason" must render.
    await page.getByLabel('Red').check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section C' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.locator('#reason')).toBeVisible();
  });
});
