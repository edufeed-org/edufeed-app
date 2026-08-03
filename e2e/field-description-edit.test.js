/**
 * TestOER probe for 27e90bb7 — per-field descriptions, in a real browser.
 *
 * Fizz named two gaps: `fieldToState` moved into builder-state.js is used by
 * TWO FormBuilder call sites (edit at :121, fork at :268) and neither was
 * driven in a browser; and the renderer shows `options.description` for ANY
 * parsed event, including foreign ones, where the value was never tested.
 *
 *   I  publish with descriptions -> /edit -> are they still in the textareas,
 *      newlines intact, and do they still render in the preview
 *   J  the same via the fork dialog, the other call site
 *   K  a hostile description renders as inert TEXT, not markup
 *
 * I is the one that matters: a description that survives publish but not
 * re-edit is erased the first time an author reopens their own form, and the
 * publish direction cannot see that.
 */
import { test, expect } from './fixtures.js';

const RUN_ID = Date.now();
const BULLETS = 'Was hat sich verändert?\n• erste Frage\n• zweite Frage';

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 */
function fieldRow(page, index) {
  return page.locator('[role="listitem"][data-item-type="field"]').nth(index);
}

/** @param {import('@playwright/test').Locator} row */
function descriptionBox(row) {
  return row.getByPlaceholder('Description / help text (optional)');
}

/**
 * Build and publish a form whose single textarea field carries a multi-line
 * description. Returns the published naddr URL.
 * @param {import('@playwright/test').Page} page
 */
async function publishFormWithDescription(page, suffix) {
  await page.goto('/forms/new');
  const nameInput = page.getByPlaceholder(/Form name/i);
  await expect(nameInput).toBeVisible({ timeout: 15000 });
  await nameInput.fill(`E2E Desc ${suffix} ${RUN_ID}`);
  await page.getByLabel('Public responses').check();

  await page.getByRole('button', { name: 'textarea', exact: true }).click();
  const row = fieldRow(page, 0);
  const labelInput = row.getByPlaceholder('Enter field name');
  await labelInput.fill('Reflexion');
  await labelInput.blur();
  await descriptionBox(row).fill(BULLETS);
  await expect(descriptionBox(row)).toHaveValue(BULLETS);

  await page.getByRole('button', { name: 'Publish Form', exact: true }).click();
  await page.waitForURL(/\/forms\/naddr1[a-z0-9]+\/?$/i, { timeout: 20000 });
  return page.url();
}

test.describe('Per-field descriptions survive the edit cycle (E2E)', () => {
  test('I — a description written once is still there after re-opening the form to edit', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(180000);
    const formUrl = await publishFormWithDescription(page, 'edit');

    // Re-open for edit. This is FormBuilder.svelte:121 — the `existing` path.
    await page.goto(formUrl.replace(/\/$/, '') + '/edit');
    const row = fieldRow(page, 0);
    await expect(row.getByPlaceholder('Enter field name')).toHaveValue('Reflexion', {
      timeout: 20000
    });

    // The whole point: the description came back, with its newlines.
    await expect(descriptionBox(row)).toHaveValue(BULLETS);
    const raw = await descriptionBox(row).inputValue();
    expect(raw.split('\n')).toHaveLength(3);

    // And it still reaches the renderer from re-loaded state.
    await page.getByTestId('open-preview').click();
    const preview = page.getByTestId('preview-dialog');
    await expect(preview).toBeVisible({ timeout: 15000 });
    const shown = preview.getByTestId('field-description');
    await expect(shown).toHaveCount(1);
    expect((await shown.innerText()).replace(/\r/g, '')).toBe(BULLETS);
  });

  test('J — the fork dialog carries descriptions into the new form', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(180000);
    const formUrl = await publishFormWithDescription(page, 'fork');
    const naddr = (formUrl.match(/naddr1[a-z0-9]+/i) || [])[0];
    expect(naddr).toBeTruthy();

    // FormBuilder.svelte:268 — the other fieldToState call site.
    await page.goto('/forms/new');
    await page.getByRole('button', { name: 'Fork from…' }).click();
    await page.getByPlaceholder('naddr1...').fill(naddr);
    await page.getByRole('button', { name: 'Load', exact: true }).click();

    const row = fieldRow(page, 0);
    await expect(row.getByPlaceholder('Enter field name')).toHaveValue('Reflexion', {
      timeout: 20000
    });
    await expect(descriptionBox(row)).toHaveValue(BULLETS);
  });

  test('K — a hostile description renders as text, not markup', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(120000);
    const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</' + 'script>';

    await page.goto('/forms/new');
    const nameInput = page.getByPlaceholder(/Form name/i);
    await expect(nameInput).toBeVisible({ timeout: 15000 });
    await nameInput.fill(`E2E Desc Hostile ${RUN_ID}`);

    await page.getByRole('button', { name: 'text', exact: true }).click();
    const row = fieldRow(page, 0);
    const labelInput = row.getByPlaceholder('Enter field name');
    await labelInput.fill('Feld');
    await labelInput.blur();
    await descriptionBox(row).fill(HOSTILE);

    await page.getByTestId('open-preview').click();
    const preview = page.getByTestId('preview-dialog');
    await expect(preview).toBeVisible({ timeout: 15000 });

    const shown = preview.getByTestId('field-description');
    await expect(shown).toHaveCount(1);
    // Rendered verbatim as text…
    expect(await shown.innerText()).toBe(HOSTILE);
    // …and no element was created from it, in the dialog or anywhere.
    expect(await preview.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__pwned)).toBeUndefined();
  });
});
