/**
 * E2E: read-only npub login (NPUB_LOGIN_ENABLED).
 * The feature flag is injected by intercepting /api/config, so the test is
 * independent of the dev server's .env.
 */
import { test, expect } from '@playwright/test';
import { nip19 } from 'nostr-tools';

const PUBKEY = 'ee11a5dff40c19a555f41fe42b48f00e618c91225622ae37b6c2bb67b76c4e49';
const NPUB = nip19.npubEncode(PUBKEY);

/**
 * Enable npubLogin in the runtime config for this page.
 *
 * /api/config is fetched by the root layout's universal load during SSR and
 * inlined into the served HTML as a `data-sveltekit-fetched` cache entry, so
 * the browser never re-requests it on first load — intercepting the API route
 * alone has no effect. Rewrite the flag inside the document response (it
 * appears JSON-escaped inside the inlined body) and also intercept the API
 * route for any later client-side fetches.
 */
async function enableNpubLogin(page) {
  const flagOn = (text) =>
    text
      .replaceAll('\\"npubLogin\\":{\\"enabled\\":false}', '\\"npubLogin\\":{\\"enabled\\":true}')
      .replaceAll('"npubLogin":{"enabled":false}', '"npubLogin":{"enabled":true}');

  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.npubLogin = { enabled: true };
    await route.fulfill({ response, json });
  });

  // Registered last → matched first (Playwright routes are LIFO); non-document
  // requests fall through to the /api/config route above or the network.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, body: flagOn(await response.text()) });
  });
}

test.describe('npub read-only login', () => {
  test('npub method hidden when flag disabled', async ({ page }) => {
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="login-method-npub"]')).toHaveCount(0);
  });

  test('login with npub, see readonly notice in inbox', async ({ page }) => {
    await enableNpubLogin(page);
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="login-method-npub"]').click();
    await expect(page.locator('#global-npub-login-modal')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="npub-input"]').fill(NPUB);
    await page.locator('[data-testid="npub-login-submit"]').click();

    // After successful add, `onAccountCreated` transitions the modal manager
    // back to 'login' — so the npub modal closing may re-open the login modal.
    // Assert on the login modal re-opening (more reliable than asserting the
    // npub modal's non-visibility, which can race with the transition) and
    // close it before navigating.
    await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#global-login-modal')).not.toBeVisible({ timeout: 5000 });

    // /inbox is a client-side redirect stub -> the real inbox page lives at
    // /c/inbox (src/routes/c/(dashboard)/inbox/+page.svelte), where
    // <ReadonlyNotice /> is mounted. Wait for the redirect to land before
    // asserting.
    await page.goto('/inbox');
    await page.waitForURL('**/c/inbox', { timeout: 10000 });
    // .first(): the c/(dashboard) layout renders children more than once for
    // its responsive (desktop/mobile) variants, so the notice appears twice.
    await expect(page.locator('[data-testid="readonly-notice"]').first()).toBeVisible({
      timeout: 10000
    });
  });

  test('invalid input shows inline error', async ({ page }) => {
    await enableNpubLogin(page);
    await page.goto('/');
    await page.locator('button:has-text("Login")').first().click();
    await page.locator('[data-testid="login-method-npub"]').click();
    await page.locator('[data-testid="npub-input"]').fill('npub1notvalid');
    await page.locator('[data-testid="npub-login-submit"]').click();
    await expect(page.locator('#global-npub-login-modal .alert-error')).toBeVisible();
  });
});
