/**
 * E2E for the form-builder PREVIEW (issue #77).
 *
 * The sibling spec `form-builder-authoring.test.js` proves that sections,
 * option→section routing and show-if survive into the fill wizard — but it can
 * only do so by *publishing* the template and following the "Fill Form" link.
 * That is exactly the cost #77 is about: to see your own form you had to burn a
 * `d`-tag identifier and publish.
 *
 * This spec drives the SAME form through the SAME assertions from the preview,
 * with no publish, no relay round-trip and no naddr. Keeping the assertions
 * identical is the point: it is what makes "the preview shows you the real
 * thing" a measured claim rather than a design intention. The build steps
 * deliberately mirror the sibling spec; if you change the form shape there,
 * change it here too.
 *
 * It also pins the two things the OLD preview (`<FormRenderer readonly />`,
 * still what the published-form page rendered before this change) structurally
 * could not show: the section wizard chrome (Next/Back) and live required-field
 * validation. Under `readonly` FormRenderer flattens every section onto one
 * page with disabled inputs and no buttons, so a spec asserting "Next exists
 * and advances" fails against it — which is what makes those assertions
 * meaningful rather than decorative.
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

test.describe('Form builder: preview without publishing (E2E)', () => {
  test('previews the 3-section form and obeys routing, show-if and validation — with nothing published', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(120000);

    await page.goto('/forms/new');
    const nameInput = page.getByPlaceholder(/Form name/i);
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill(`E2E Preview Form ${RUN_ID}`);

    // --- Section A: radio "Color" (required) with options Red/Blue ---
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 0).getByPlaceholder('Section title').fill('Section A');

    await page.getByRole('button', { name: 'radio', exact: true }).click();
    const colorRow = fieldRow(page, 0);
    const colorLabelInput = colorRow.getByPlaceholder('Enter field name');
    await colorLabelInput.fill('Color');
    await colorLabelInput.blur();
    // Required — so the preview can demonstrate validation actually firing.
    await colorRow.getByLabel('Required').check();
    await colorRow.getByRole('button', { name: 'Add options manually' }).click();
    const newOptionInput = colorRow.getByPlaceholder('New option');
    await newOptionInput.fill('Red');
    await newOptionInput.press('Enter');
    await newOptionInput.fill('Blue');
    await newOptionInput.press('Enter');

    // --- Section B: reached only by linear fallthrough ---
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 1).getByPlaceholder('Section title').fill('Section B');
    await page.getByRole('button', { name: 'text', exact: true }).click();
    const noteLabelInput = fieldRow(page, 1).getByPlaceholder('Enter field name');
    await noteLabelInput.fill('Note');
    await noteLabelInput.blur();

    // --- Section C: "Reason", shown only if Color equals Red ---
    await page.getByRole('button', { name: 'Add section' }).click();
    await sectionRow(page, 2).getByPlaceholder('Section title').fill('Section C');
    await page.getByRole('button', { name: 'text', exact: true }).click();
    const reasonRow = fieldRow(page, 2);
    const reasonLabelInput = reasonRow.getByPlaceholder('Enter field name');
    await reasonLabelInput.fill('Reason');
    await reasonLabelInput.blur();

    const conditionRow = reasonRow.locator('div.flex-wrap.items-center.gap-2.text-sm');
    await conditionRow.locator('select').nth(0).selectOption({ label: 'Color' });
    await conditionRow.locator('select').nth(2).selectOption({ label: 'Red' });

    // Route "Red" → Section C, skipping Section B.
    await colorRow.locator('.badge', { hasText: 'Red' }).locator('select').selectOption({
      label: 'Section C'
    });

    // --- Open the preview. No publish, no navigation. ---
    const urlBeforePreview = page.url();
    await page.getByTestId('open-preview').click();

    const preview = page.getByTestId('preview-dialog');
    await expect(preview).toBeVisible({ timeout: 15000 });

    // Wizard chrome exists at all — impossible under the old readonly preview,
    // which renders every section flat with no navigation buttons.
    const next = preview.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeVisible();

    // Section A first; neither later section's field is rendered yet.
    await expect(preview.getByRole('heading', { name: 'Section A' })).toBeVisible();
    await expect(preview.locator('#note')).toHaveCount(0);
    await expect(preview.locator('#reason')).toHaveCount(0);

    // Validation is live: Color is required, so Next must not advance.
    await next.click();
    await expect(preview.getByText('Color is required')).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Section A' })).toBeVisible();

    // "Blue" has no route → linear fallthrough A → B.
    await preview.getByLabel('Blue').check();
    await next.click();
    await expect(preview.getByRole('heading', { name: 'Section B' })).toBeVisible();
    await expect(preview.locator('#note')).toBeVisible();
    await expect(preview.locator('#reason')).toHaveCount(0);

    // B → C linearly. Color is still Blue, so show-if is false and "Reason"
    // stays hidden even though Section C — which owns it — has been reached.
    await next.click();
    await expect(preview.getByRole('heading', { name: 'Section C' })).toBeVisible();
    await expect(preview.locator('#reason')).toHaveCount(0);

    // Back twice: C → B → A.
    const back = preview.getByRole('button', { name: 'Back', exact: true });
    await back.click();
    await expect(preview.getByRole('heading', { name: 'Section B' })).toBeVisible();
    await back.click();
    await expect(preview.getByRole('heading', { name: 'Section A' })).toBeVisible();

    // "Red" fires the explicit route: Section C directly, skipping B. With three
    // sections, linear order would have gone to B (as it just did for Blue), so
    // landing on C is only explainable by the route. Show-if is now true too.
    await preview.getByLabel('Red').check();
    await next.click();
    await expect(preview.getByRole('heading', { name: 'Section C' })).toBeVisible();
    await expect(preview.locator('#reason')).toBeVisible();

    // --- Nothing was published ---
    // Still on /forms/new: publishing navigates to /forms/naddr1…, so an
    // unchanged URL is the observable that no template went out.
    expect(page.url()).toBe(urlBeforePreview);
    expect(page.url()).not.toMatch(/naddr1/);

    // Closing returns to the builder with the authored state intact.
    await page.getByTestId('close-preview').click();
    await expect(preview).toHaveCount(0);
    await expect(colorRow.getByPlaceholder('Enter field name')).toHaveValue('Color');
  });
});
