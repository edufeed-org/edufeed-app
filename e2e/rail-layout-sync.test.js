/**
 * The rail's arrangement follows the user to a second device.
 *
 * This is the claim the whole feature makes, and it is the one thing the unit
 * tests cannot show: they mock the relay, so they prove the pieces agree with
 * each other, not that an arrangement survives a real encrypt, a real relay,
 * and a real second browser profile that has never seen this user's
 * localStorage.
 *
 * Two things are deliberate about the shape:
 *
 *  - The arrangement is made by DRAGGING, not by seeding storage and
 *    reloading. A `goto` into a pre-arranged state would exercise the read
 *    path against a fixture the write path never produced.
 *  - The second device is a fresh browser CONTEXT, not a reload. A reload
 *    keeps localStorage, which is exactly the thing that used to carry the
 *    layout — so a reload would pass even with sync entirely absent.
 *
 * There is also a websocket ledger over the WHOLE test rather than a settle
 * window: this lane is the first that publishes an event frame, so "did
 * anything leave for a real relay" is worth answering without a window in
 * which a zero could mean "nothing yet".
 */
import { test, expect } from '@playwright/test';
import { TEST_AUTHOR } from './test-data.js';

/** Log in through the UI, the way fixtures.js does. */
async function loginAs(page, nsec) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('app-ready'), {
    timeout: 30_000
  });

  await page.locator('button:has-text("Login")').first().click();
  await expect(page.locator('#global-login-modal')).toBeVisible({ timeout: 10_000 });
  await page.locator('#global-login-modal [data-testid="login-method-nsec"]').click();
  await expect(page.locator('#global-private-key-modal')).toBeVisible({ timeout: 10_000 });
  await page.locator('#nsec-input').fill(nsec);
  await page.locator('#global-private-key-modal button.btn-primary').click();

  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('dialog[open]').isVisible())) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

/** The rail's entry keys, top to bottom. */
async function railOrder(page) {
  // data-rail-anchor is the stable key the model orders by; textContent would
  // compare labels, which two containers can share.
  return page
    .locator('[data-testid="rail-slot"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rail-anchor') ?? ''));
}

/** Record every websocket the page opens, for the whole test. */
function watchSockets(page, sink) {
  page.on('websocket', (ws) => sink.push(ws.url()));
}

test.describe('rail layout sync', () => {
  test('an arrangement made on one device appears on a second', async ({ browser }) => {
    /** @type {string[]} */
    const sockets = [];

    // --- device one -------------------------------------------------------
    const deviceOne = await browser.newContext();
    const pageOne = await deviceOne.newPage();
    watchSockets(pageOne, sockets);
    await loginAs(pageOne, TEST_AUTHOR.nsec);

    const slots = pageOne.locator('[data-testid="rail-slot"]');
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });

    // Reordering needs something to reorder. Asserted rather than assumed:
    // with one entry the drag is a no-op and the whole test would pass
    // without ever exercising sync.
    const count = await slots.count();
    expect(
      count,
      'the rail needs at least two entries for a reorder to mean anything'
    ).toBeGreaterThanOrEqual(2);

    const before = await railOrder(pageOne);
    await slots.nth(1).dragTo(slots.nth(0));

    await expect
      .poll(async () => (await railOrder(pageOne))[0], { timeout: 15_000 })
      .toBe(before[1]);
    const after = await railOrder(pageOne);

    // --- device two: a profile that has never seen this user ---------------
    const deviceTwo = await browser.newContext();
    const pageTwo = await deviceTwo.newPage();
    watchSockets(pageTwo, sockets);

    // The control for the whole test. If storage leaked between contexts,
    // device two would "pass" without the relay having carried anything.
    const leaked = await pageTwo.evaluate(() => {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith('rail-layout:'));
      } catch {
        return [];
      }
    });
    expect(leaked, 'device two must start with no rail layout of its own').toEqual([]);

    await loginAs(pageTwo, TEST_AUTHOR.nsec);
    await expect(pageTwo.locator('[data-testid="rail-slot"]').first()).toBeVisible({
      timeout: 20_000
    });

    await expect
      .poll(async () => (await railOrder(pageTwo)).join('|'), { timeout: 30_000 })
      .toBe(after.join('|'));

    // --- the sandbox stayed a sandbox --------------------------------------
    const offBox = sockets.filter((url) => !/^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url));
    expect(offBox, 'no websocket may leave the sandbox').toEqual([]);
    expect(sockets.length, 'the ledger must have seen something at all').toBeGreaterThan(0);

    await deviceOne.close();
    await deviceTwo.close();
  });
});
