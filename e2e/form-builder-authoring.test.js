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
 * Flow: build a 2-section form (Section A: radio field with two options,
 * "Red" routed to Section B; Section B: a text field shown only if the
 * radio equals "Red") in `/forms/new`, publish, follow the in-app "Fill
 * Form" link, and drive the wizard both ways — picking "Blue" (no explicit
 * route, falls through to Section B by linear order, but the show-if
 * condition is false) and picking "Red" (explicit route AND the show-if
 * condition is true) — to prove both routing and conditional visibility.
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
  test('builds a 2-section form with routing + show-if, publishes, and the fill wizard obeys both', async ({
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

    // --- Section B ---
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 1).getByPlaceholder('Section title').fill('Section B');

    // Route option "Red" → Section B (only appears once ≥1 section exists,
    // and now both sections are available in its dropdown).
    const redBadge = colorRow.locator('.badge', { hasText: 'Red' });
    await redBadge.locator('select').selectOption({ label: 'Section B' });

    // Text field "Reason" (falls after the Section B marker → belongs to
    // Section B), shown only if Color equals Red.
    await page.getByRole('button', { name: 'text', exact: true }).click();
    const reasonRow = fieldRow(page, 1);
    const reasonLabelInput = reasonRow.getByPlaceholder('Enter field name');
    await reasonLabelInput.fill('Reason');
    await reasonLabelInput.blur();

    // FormBuilderConditionRow's root div is the only one in this row with
    // this exact 4-class combo (the output-picker row lacks `flex-wrap`).
    const conditionRow = reasonRow.locator('div.flex-wrap.items-center.gap-2.text-sm');
    await conditionRow.locator('select').nth(0).selectOption({ label: 'Color' });
    // Operator defaults to "equals" — leave as-is.
    await conditionRow.locator('select').nth(2).selectOption({ label: 'Red' });

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
    // The show-if field belongs to Section B — not rendered yet.
    await expect(page.locator('#reason')).toHaveCount(0);

    // Pick "Blue" (no explicit route → falls through to Section B by
    // linear order) — Section B is reached, but the show-if condition
    // (Color equals Red) is false, so "Reason" must NOT render.
    await page.getByLabel('Blue').check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section B' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.locator('#reason')).toHaveCount(0);

    // Back to Section A, pick "Red" (explicit option→section route to
    // Section B, AND the show-if condition becomes true) — "Reason" must
    // render this time.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section A' })).toBeVisible();
    await page.getByLabel('Red').check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Section B' })).toBeVisible({
      timeout: 15000
    });
    await expect(page.locator('#reason')).toBeVisible();
  });
});
