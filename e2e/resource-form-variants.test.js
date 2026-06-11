/**
 * E2E tests for the multi-variant Resource Form Wizard (Phase 1).
 *
 * Phase 1 ships plumbing only — a single enabled variant (`amb`) in the
 * default E2E config. These tests cover the routing shape we now expect:
 *
 *   - Direct navigation to `/create/resource/amb` renders the wizard.
 *   - Direct navigation to `/create/resource` (legacy entrypoint) redirects
 *     to the default variant-addressed route while preserving query params.
 *   - Published events carry the NIP-32 `metadata-form` label — covered by
 *     unit tests (`src/lib/__tests__/educational-actions-tags.test.js`), not
 *     repeated here.
 *
 * Multi-variant picker behavior (RESOURCE_FORM_VARIANTS=amb,ekw) is not
 * exercised here because the current E2E webServer config runs single-variant
 * to keep the 29 existing AMB regression tests working unchanged. The picker
 * modal itself is covered by the component test
 * (`src/lib/components/__tests__/ResourceVariantPickerModal.test.js`) and the
 * FAB wiring is covered by `GlobalFAB.test.js`.
 */
import { test, expect } from './fixtures.js';
import { TEST_COMMUNITY } from './test-data.js';

test.describe('Resource Form Variants — routing', () => {
  test('direct navigation to /create/resource/amb renders the wizard', async ({
    authenticatedPage: page
  }) => {
    await page.goto('/create/resource/amb');
    await page.waitForTimeout(1500);

    // Wizard starts on the Bildungsbereich step.
    await expect(page.locator('input[name="bildungsbereich"]').first()).toBeVisible({
      timeout: 10000
    });
    await expect(page.locator('button:has-text("Next")')).toBeVisible();
  });

  test('legacy /create/resource redirects to default variant route', async ({
    authenticatedPage: page
  }) => {
    await page.goto(`/create/resource?community=${TEST_COMMUNITY.npub}`);

    // Redirector is async (awaits configReady + optional edit-event lookup)
    // — wait for the URL to settle on the variant-addressed route.
    await page.waitForURL(/\/create\/resource\/amb/, { timeout: 15000 });

    // Community query param must survive the redirect so the wizard can
    // preselect the community on the share step.
    expect(page.url()).toContain(`community=${TEST_COMMUNITY.npub}`);

    // Wizard should render after the redirect.
    await expect(page.locator('input[name="bildungsbereich"]').first()).toBeVisible({
      timeout: 10000
    });
  });

  test('invalid variant id in URL does not resolve the wizard route', async ({
    authenticatedPage: page
  }) => {
    // The param matcher should reject `not-a-real-variant`, causing the
    // variant-addressed route not to resolve. We accept either a 404-style
    // fallback or a client-side redirect to a safer page.
    const response = await page.goto('/create/resource/not-a-real-variant', {
      waitUntil: 'domcontentloaded'
    });
    // Either the server returned a non-200 for the unresolved route, or the
    // client rendered a page without the wizard. Assert the negative: the
    // wizard input is NOT visible.
    void response;
    await page.waitForTimeout(1500);
    await expect(page.locator('input[name="bildungsbereich"]')).toHaveCount(0);
  });
});
