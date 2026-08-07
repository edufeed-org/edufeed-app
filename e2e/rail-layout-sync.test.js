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
import WebSocket from 'ws';
import { finalizeEvent, nip19 } from 'nostr-tools';
import {
  TEST_AUTHOR,
  TEST_COMMUNITY,
  TEST_COMMUNITY_GATED,
  RELAY_URLS
} from './test-data.js';

/**
 * Give TEST_AUTHOR two joined communities, so the rail has something to
 * arrange. Seeded here rather than in the shared fixture because it is this
 * test's precondition, and because a reorder needs exactly this and nothing
 * else — the shared author deliberately joins nothing.
 */
async function seedJoinedCommunities() {
  const event = finalizeEvent(
    {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'communities'],
        ['p', TEST_COMMUNITY.pubkey],
        ['p', TEST_COMMUNITY_GATED.pubkey]
      ],
      content: ''
    },
    // nip19 rather than @noble/hashes/utils: that specifier does not
    // resolve in this workspace (it is what breaks pomegranate-service.test.js).
    /** @type {Uint8Array} */ (nip19.decode(TEST_AUTHOR.nsec).data)
  );

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URLS.strfry);
    const done = (err) => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      err ? reject(err) : resolve(undefined);
    };
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] !== 'OK') return;
      // A relay that rejects this leaves the rail empty, which would fail
      // later as "no slots" and read like a UI bug. Fail here instead.
      done(msg[2] ? null : new Error(`relay rejected the follow set: ${msg[3]}`));
    });
    ws.on('error', done);
    setTimeout(() => done(new Error('timed out seeding the follow set')), 10_000);
  });

  return event;
}

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

const isLocal = (/** @type {string} */ url) =>
  /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);

/**
 * Watch every websocket for the whole test — no settle window, because a
 * windowed zero cannot be told apart from a real one.
 *
 * Two ledgers, because they answer different questions. `opened` is every
 * connection, and it is NOT clean here: the app dials production relays from
 * relay hints carried inside naddr config values, which no relay env override
 * can reach. That is a pre-existing property of the sandbox, not of this
 * feature, and it is reported rather than asserted on.
 *
 * `offBoxEvents` is the one this lane must keep empty. It is the first lane
 * that PUBLISHES, so the question that matters is not "did a socket open" but
 * "did an EVENT frame carrying a user's arrangement leave this box".
 */
function watchSockets(page, opened, offBoxEvents) {
  page.on('websocket', (ws) => {
    const url = ws.url();
    opened.push(url);
    if (isLocal(url)) return;
    ws.on('framesent', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : '';
      if (/^\s*\[\s*"EVENT"/.test(payload)) offBoxEvents.push({ url, payload });
    });
  });
}

test.describe('rail layout sync', () => {
  test('an arrangement made on one device appears on a second', async ({ browser }) => {
    /** @type {string[]} */
    const sockets = [];
    /** @type {Array<{url: string, payload: string}>} */
    const offBoxEvents = [];

    await seedJoinedCommunities();

    // --- device one -------------------------------------------------------
    const deviceOne = await browser.newContext();
    const pageOne = await deviceOne.newPage();
    watchSockets(pageOne, sockets, offBoxEvents);
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

    // Dropping a row onto the CENTRE of another is the make-a-folder intent
    // (the top and bottom thirds reorder instead), so this drag produces a
    // folder. That is the better arrangement to carry across: a folder holds
    // a name and a member list, so a sync scheme that quietly flattens one
    // fails here, where a bare reorder would still look correct.
    await slots.nth(1).dragTo(slots.nth(0));

    await expect
      .poll(async () => (await railOrder(pageOne)).some((k) => k.startsWith('folder:')), {
        timeout: 15_000
      })
      .toBe(true);
    const after = await railOrder(pageOne);
    expect(after, 'the drag must actually change the arrangement').not.toEqual(before);

    // --- device two: a profile that has never seen this user ---------------
    const deviceTwo = await browser.newContext();
    const pageTwo = await deviceTwo.newPage();
    watchSockets(pageTwo, sockets, offBoxEvents);

    // The control for the whole test: if storage leaked between contexts,
    // device two would "pass" without the relay having carried anything.
    // Read on the APP's origin — on about:blank this is a different storage
    // area, so it would return empty regardless and the control could never
    // fail. No try/catch either, for the same reason: a swallowed error here
    // reads as "clean".
    await pageTwo.goto('/');
    const leaked = await pageTwo.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('rail-layout:'))
    );
    expect(leaked, 'device two must start with no rail layout of its own').toEqual([]);

    await loginAs(pageTwo, TEST_AUTHOR.nsec);
    await expect(pageTwo.locator('[data-testid="rail-slot"]').first()).toBeVisible({
      timeout: 20_000
    });

    await expect
      .poll(async () => (await railOrder(pageTwo)).join('|'), { timeout: 30_000 })
      .toBe(after.join('|'));

    // --- nothing this feature wrote left the box ---------------------------
    // The ledger must have seen traffic at all, or an empty result below would
    // just mean the watcher never fired.
    expect(sockets.length, 'the ledger must have seen something at all').toBeGreaterThan(0);
    expect(
      sockets.some(isLocal),
      'the app must have talked to the sandbox relays'
    ).toBe(true);

    // The assertion this lane owns: no EVENT frame reached a relay outside the
    // sandbox. Connections to production DO happen here — relay hints inside
    // naddr config values survive every relay env override — so this is
    // deliberately about frames, not about sockets.
    expect(offBoxEvents, 'no EVENT frame may leave the sandbox').toEqual([]);

    await deviceOne.close();
    await deviceTwo.close();
  });
});
