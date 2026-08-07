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
import { TEST_AUTHOR, TEST_COMMUNITY, TEST_COMMUNITY_GATED, RELAY_URLS } from './test-data.js';

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

/**
 * The rail is mounted TWICE at once: the desktop rail at
 * `src/routes/+layout.svelte:373` (`hidden lg:contents`) and the mobile drawer
 * rail at `src/routes/c/+layout.svelte:178` (`lg:hidden`, guarded only by
 * `activeUser()`). Both are in the DOM on a `/c/` route, so a bare
 * `[data-testid="rail-slot"]` matches every row twice and `railOrder` returned
 * the two rails concatenated — `A|B|A|B`. The cross-device comparison still
 * held, because both sides doubled identically, but it was comparing something
 * other than what it read as, and a genuine duplicate entry would have been
 * indistinguishable from the second mount.
 *
 * `:visible` scopes to the one rail the viewport actually shows.
 */
const RAIL_SLOT = '[data-testid="rail-slot"]:visible';

/** The rail's entry keys, top to bottom. */
async function railOrder(page) {
  // data-rail-anchor is the stable key the model orders by; textContent would
  // compare labels, which two containers can share.
  return page
    .locator(RAIL_SLOT)
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-rail-anchor') ?? ''));
}

const isLocal = (/** @type {string} */ url) =>
  /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);

/** The kind of the event in an `["EVENT", {...}]` frame, or null for anything else. */
function eventKindOf(/** @type {string} */ payload) {
  if (!/^\s*\[\s*"EVENT"/.test(payload)) return null;
  try {
    const kind = JSON.parse(payload)?.[1]?.kind;
    return typeof kind === 'number' ? kind : null;
  } catch {
    return null;
  }
}

/**
 * Watch every websocket for the whole test — no settle window, because a
 * windowed zero cannot be told apart from a real one.
 *
 * Three ledgers, because they answer different questions. `opened` is every
 * connection, and it is NOT clean here: the app dials production relays from
 * relay hints carried inside naddr config values, which no relay env override
 * can reach. That is a pre-existing property of the sandbox, not of this
 * feature, and it is reported rather than asserted on.
 *
 * `offBoxEvents` is the one this lane must keep empty. It is the first lane
 * that PUBLISHES, so the question that matters is not "did a socket open" but
 * "did an EVENT frame carrying a user's arrangement leave this box".
 *
 * `localEvents` exists only to calibrate that zero, and the listener is
 * attached to local and off-box sockets by the SAME code path — a ledger that
 * has never been observed producing a row cannot distinguish "nothing leaked"
 * from "the watcher was never wired". An earlier version of this file attached
 * `framesent` only inside the off-box branch, so the assertion below rested on
 * an instrument that, within the test, had never emitted anything at all.
 */
function watchSockets(page, opened, localEvents, offBoxEvents) {
  page.on('websocket', (ws) => {
    const url = ws.url();
    opened.push(url);
    const sink = isLocal(url) ? localEvents : offBoxEvents;
    ws.on('framesent', (frame) => {
      const payload = typeof frame.payload === 'string' ? frame.payload : '';
      const kind = eventKindOf(payload);
      if (kind !== null) sink.push({ url, kind, payload });
    });
  });
}

test.describe('rail layout sync', () => {
  test('an arrangement made on one device appears on a second', async ({ browser }) => {
    /** @type {string[]} */
    const sockets = [];
    /** @type {Array<{url: string, kind: number, payload: string}>} */
    const localEvents = [];
    /** @type {Array<{url: string, kind: number, payload: string}>} */
    const offBoxEvents = [];

    await seedJoinedCommunities();

    // --- device one -------------------------------------------------------
    const deviceOne = await browser.newContext();
    const pageOne = await deviceOne.newPage();
    watchSockets(pageOne, sockets, localEvents, offBoxEvents);
    await loginAs(pageOne, TEST_AUTHOR.nsec);

    const slots = pageOne.locator(RAIL_SLOT);
    await expect(slots.first()).toBeVisible({ timeout: 20_000 });

    // The two rows this test drags, addressed by the key the model orders by
    // rather than by index. `nth(1)` names whatever happens to be second,
    // which in a run that already created a folder is the folder — the drag
    // then aims at a row that is not what the test means and fails as a
    // 60s `dragTo` timeout, which reads as a broken harness rather than as
    // stale state. Naming both anchors is also the "something to reorder"
    // check: two distinct anchors cannot be one entry.
    const seededRow = (/** @type {string} */ pubkey) =>
      pageOne.locator(`${RAIL_SLOT}[data-rail-anchor="community:${pubkey}"]`);
    const dragged = seededRow(TEST_COMMUNITY_GATED.pubkey);
    const target = seededRow(TEST_COMMUNITY.pubkey);
    await expect(dragged, 'the seeded gated community must be on the rail').toBeVisible({
      timeout: 20_000
    });
    await expect(target, 'the seeded community must be on the rail').toBeVisible({
      timeout: 20_000
    });

    const before = await railOrder(pageOne);

    // Addressing rows by anchor is only sound if an anchor names ONE row.
    // Asserted rather than assumed: this is what the second mount broke, and
    // it holds whether or not that mount is ever removed.
    expect(
      new Set(before).size,
      'each rail anchor must appear exactly once in the visible rail'
    ).toBe(before.length);

    // Dropping a row onto the CENTRE of another is the make-a-folder intent
    // (the top and bottom thirds reorder instead), so this drag produces a
    // folder. That is the better arrangement to carry across: a folder holds
    // a name and a member list, so a sync scheme that quietly flattens one
    // fails here, where a bare reorder would still look correct.
    await dragged.dragTo(target);

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
    watchSockets(pageTwo, sockets, localEvents, offBoxEvents);

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
    await expect(pageTwo.locator(RAIL_SLOT).first()).toBeVisible({
      timeout: 20_000
    });

    await expect
      .poll(async () => (await railOrder(pageTwo)).join('|'), { timeout: 30_000 })
      .toBe(after.join('|'));

    // --- nothing this feature wrote left the box ---------------------------
    console.log('[ledger] sockets seen        :', sockets.length);
    console.log(
      '[ledger] local  EVENT frames :',
      localEvents.length,
      'kinds:',
      [...new Set(localEvents.map((e) => e.kind))].join(',')
    );
    console.log('[ledger] offbox EVENT frames :', offBoxEvents.length);
    console.log('[ledger] offbox sockets      :', [...new Set(sockets.filter((u) => !isLocal(u)))]);

    // Calibration, and it has to come first: the off-box zero below is only
    // evidence if this same listener is known to be capable of recording a
    // row. Asserting on kind 30078 specifically — not just "some frame" —
    // because 30078 is the frame the off-box assertion is hunting for, so
    // this proves the instrument can catch the exact thing it must not miss.
    expect(
      localEvents.some((e) => e.kind === 30078),
      'the frame watcher must be shown recording the app-data kind it is watching for'
    ).toBe(true);

    // Subsumes the older `sockets.some(isLocal)` check: an EVENT frame on a
    // local socket cannot happen without a local socket the watcher saw.
    expect(sockets.length, 'the ledger must have seen something at all').toBeGreaterThan(0);

    // The assertion this lane owns: no EVENT frame reached a relay outside the
    // sandbox. Connections to production DO happen here — relay hints inside
    // naddr config values survive every relay env override — so this is
    // deliberately about frames, not about sockets.
    expect(offBoxEvents, 'no EVENT frame may leave the sandbox').toEqual([]);

    await deviceOne.close();
    await deviceTwo.close();
  });
});
