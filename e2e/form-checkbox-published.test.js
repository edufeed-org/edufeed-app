/**
 * Written by TestOER as an independent probe of 8c6883d6 (#77), and kept
 * because it is the only spec in the repo that drives a required checkbox past
 * publish.
 *
 * ORIGIN — and its result, which was to REFUTE the claim it was built to test.
 * An earlier draft of the #77 commit said a required checkbox had been
 * impossible to submit on every published form, reasoning that validateField
 * wanted the string 'true' while FieldsRenderer emits input.checked, a boolean.
 * Both halves are true of those two files read alone; the conclusion is not,
 * because FormRenderer.handleFieldChange stringifies the boolean between them
 * and always has. This spec is what established that — run with the pre-fix
 * expression restored, it still submits. The commit message was corrected.
 *
 * Keep it. It measures the seam that a code read got wrong, on the route where
 * it would actually bite, which is the published fill route rather than the
 * preview dialog every other measurement was taken inside.
 *
 * Two required checkboxes, because the fix splits one type into two shapes:
 *   - "Consent"  — no options → boolean toggle → the value !== 'true' bug
 *   - "Topics"   — three options → multi-select group → the reported #77 render
 *
 * Same-tab client-side navigation throughout, for the eventStore reason
 * documented at the top of form-builder-authoring.test.js.
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

test.describe('Published form: required checkbox is satisfiable (E2E)', () => {
  test('a published form with a required boolean checkbox and a required checkbox group can actually be submitted', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(120000);

    await page.goto('/forms/new');
    const nameInput = page.getByPlaceholder(/Form name/i);
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill(`E2E Checkbox Published ${RUN_ID}`);

    // Public responses — avoids the NIP-44 gate on /respond, same reason as
    // form-builder-authoring.test.js.
    await page.getByLabel('Public responses').check();

    // --- Field 0: required checkbox WITHOUT options (boolean consent toggle).
    await page.getByRole('button', { name: 'checkbox', exact: true }).click();
    const consentRow = fieldRow(page, 0);
    const consentLabel = consentRow.getByPlaceholder('Enter field name');
    await consentLabel.fill('Consent');
    await consentLabel.blur();
    await consentRow.getByLabel('Required').check();

    // --- Field 1: required checkbox WITH options (the reported case).
    await page.getByRole('button', { name: 'checkbox', exact: true }).click();
    const topicsRow = fieldRow(page, 1);
    const topicsLabel = topicsRow.getByPlaceholder('Enter field name');
    await topicsLabel.fill('Topics');
    await topicsLabel.blur();
    await topicsRow.getByLabel('Required').check();
    await topicsRow.getByRole('button', { name: 'Add options manually' }).click();
    const newOptionInput = topicsRow.getByPlaceholder('New option');
    for (const opt of ['test', 'test2', 'test3']) {
      await newOptionInput.fill(opt);
      await newOptionInput.press('Enter');
    }

    // --- Publish for real, then walk in as a respondent.
    await page.getByRole('button', { name: 'Publish Form', exact: true }).click();
    await page.waitForURL(/\/forms\/naddr1[a-z0-9]+\/?$/i, { timeout: 20000 });
    await page.getByRole('link', { name: 'Fill Form', exact: true }).click();
    await page.waitForURL(/\/forms\/naddr1[a-z0-9]+\/respond\/?$/i, { timeout: 20000 });

    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    await expect(submit).toBeVisible({ timeout: 15000 });

    // The options survived publishing: three labelled boxes, not one bare
    // toggle. Four boxes total on the page — three for Topics, one Consent.
    for (const opt of ['test', 'test2', 'test3']) {
      await expect(page.getByLabel(opt, { exact: true })).toBeVisible();
    }
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(4);

    // Both required rules fire on an empty form.
    await submit.click();
    await expect(page.getByText('Consent is required')).toBeVisible();
    await expect(page.getByText('Topics is required')).toBeVisible();

    // Tick the group only — Consent must still block. This is the assertion
    // that isolates the boolean/string mismatch from the options defect: if
    // validateField still wants the string 'true', ticking Consent below can
    // never clear it.
    await page.getByLabel('test2', { exact: true }).check();
    await submit.click();
    await expect(page.getByText('Topics is required')).toHaveCount(0);
    await expect(page.getByText('Consent is required')).toBeVisible();

    // Tick the boolean toggle. FieldsRenderer gives every option box a
    // `value={opt.id}` and the boolean box none, so `:not([value])` picks out
    // exactly the Consent checkbox — asserted to be unique, because a
    // locator that silently matched an option box would make the assertion
    // below pass for the wrong reason.
    const consentBox = page.locator('input[type="checkbox"]:not([value])');
    await expect(consentBox).toHaveCount(1);
    await consentBox.check();
    await expect(consentBox).toBeChecked();

    await submit.click();

    // The whole point: the response actually goes through.
    await expect(page.getByText('Consent is required')).toHaveCount(0);
    await expect(page.getByText('Response submitted successfully!')).toBeVisible({
      timeout: 20000
    });
  });
});
