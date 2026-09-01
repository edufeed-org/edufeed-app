/**
 * E2E for the /groups join-by-address form — the browser-level regression
 * net for the Chrome-dialect URL-parser defect (TestOER, 2026-08-04):
 * Chrome percent-encodes forbidden host bytes instead of throwing, so
 * before isValidRelayUrl, `not a pointer` parsed "fine" IN A BROWSER ONLY
 * and navigated to a chat shell for a nonexistent relay. The unit suite is
 * node-pinned and cannot exercise the lenient parser; this test runs the
 * real one.
 */
import { test, expect } from '@playwright/test';

async function gotoGroups(page) {
  await page.goto('/groups');
  await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
    timeout: 30000
  });
}

test.describe('NIP-29 group pointer input', () => {
  test('garbage input shows the invalid-pointer toast and stays on /groups', async ({ page }) => {
    await gotoGroups(page);
    await page.getByTestId('group-join-input').fill('not a pointer');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.toast-container .alert')).toContainText(
      'Not a valid group address'
    );
    expect(new URL(page.url()).pathname).toBe('/groups');
  });

  test('control: a well-formed pointer navigates to the group page', async ({ page }) => {
    await gotoGroups(page);
    await page.getByTestId('group-join-input').fill("groups.example.com'beechat");
    await page.getByRole('button', { name: 'Open' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/groups/'), { timeout: 10000 });
    expect(decodeURIComponent(new URL(page.url()).pathname)).toContain("groups.example.com'beechat");
  });

  test('a garbage pointer pasted directly as a URL renders the invalid state, not a chat shell', async ({
    page
  }) => {
    await page.goto(`/groups/${encodeURIComponent("not%20a%20pointer'_")}`);
    await page.waitForFunction(() => document.body.classList.contains('app-ready'), null, {
      timeout: 30000
    });
    await expect(page.getByText('Not a valid group address')).toBeVisible();
  });
});
