# Concord Public-Channel Invite Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make invites (link + direct) work when a public (`#`) channel is selected, by inviting to the AREA (`channels: []`) instead of a non-existent public-channel key.

**Architecture:** Client-side only. Add an area direct-invite helper that mirrors `grantChannelAccess` with `channels: []` (dynamic package imports, SSR-safe like `send-message.js`); route public channels to it; fix the link mint + reuse to use `channels: []`. No SDK/relay/protocol changes.

**Tech Stack:** SvelteKit + Svelte 5 runes, Vitest (jsdom + node), `applesauce-concord` via `src/lib/concord/` only.

## Global Constraints

- `applesauce-concord` may be imported ONLY inside `src/lib/concord/`. Use **dynamic** `import()` inside async functions (mirror `src/lib/concord/send-message.js`) to keep the concord dep tree out of SSR chunks. Components must NOT import `applesauce-concord`; they reach the helper via `import('$lib/concord/area-invite.js')`.
- Public channel → invite bundle uses `channels: []`; private channel → `channels: [channelId]`.
- `grantChannelAccess` is private-channel-only (throws on public / empty). Never pass a public channel id to it.
- Focused runner: `npx vitest run --environment jsdom <file>` for component/svelte tests; `npx vitest run <file>` for node unit tests. (`pnpm test:component -- <file>` does NOT filter in this repo.)
- TDD: failing test first.

---

### Task 1: `area-invite.js` helper + `invite-helpers` public-invite matching

**Files:**
- Create: `src/lib/concord/area-invite.js`
- Create: `src/lib/__tests__/concord-area-invite.test.js`
- Modify: `src/lib/concord/invite-helpers.js`
- Modify: `src/lib/__tests__/concord-invite-helpers.test.js`

**Interfaces — Produces:** `directInviteToArea(community, member): Promise<void>`; `pickLatestChannelInvite(links, channelId, isPrivate = true)`.

- [ ] **Step 1: Write the failing helper test.** Create `src/lib/__tests__/concord-area-invite.test.js`:
```js
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const buildInviteBundle = vi.hoisted(() => vi.fn(() => ({ bundle: true })));
const create = vi.hoisted(() => vi.fn(() => Promise.resolve({ wrap: true })));
vi.mock('applesauce-concord/helpers', () => ({ buildInviteBundle }));
vi.mock('applesauce-concord/factories', () => ({ DirectInviteFactory: { create } }));

import { directInviteToArea } from '$lib/concord/area-invite.js';

const MEMBER = 'b'.repeat(64);
function makeCommunity() {
  return {
    material: { community_id: 'cid' },
    pubkey: 'a'.repeat(64),
    signer: { sign: true },
    state$: { value: { metadata: { name: 'Area', icon: 'i' } } },
    eventStore: { add: vi.fn() },
    pool: { publish: vi.fn(() => Promise.resolve()) },
    relays: () => ['wss://r']
  };
}
beforeEach(() => { buildInviteBundle.mockClear(); create.mockClear(); });

describe('directInviteToArea', () => {
  it('builds an AREA bundle (channels: []) and gift-wraps+publishes it', async () => {
    const c = makeCommunity();
    await directInviteToArea(c, MEMBER);
    expect(buildInviteBundle).toHaveBeenCalledWith(
      c.material,
      expect.objectContaining({ channels: [], creator_npub: c.pubkey, name: 'Area' })
    );
    expect(create).toHaveBeenCalledWith({ bundle: true }, MEMBER, c.signer);
    expect(c.eventStore.add).toHaveBeenCalledWith({ wrap: true });
    expect(c.pool.publish).toHaveBeenCalledWith(['wss://r'], { wrap: true });
  });

  it('swallows a publish rejection (best-effort)', async () => {
    const c = makeCommunity();
    c.pool.publish = vi.fn(() => Promise.reject(new Error('relay down')));
    await expect(directInviteToArea(c, MEMBER)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail.** `npx vitest run src/lib/__tests__/concord-area-invite.test.js` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/concord/area-invite.js`:**
```js
// Area (public/membership) direct invite. The pinned dist's grantChannelAccess
// hands over PRIVATE channel keys and throws for a public channel or an empty
// channel list ("not a private channel we hold a key for" / "no channels to
// grant"). A public channel derives its key from community_root, so inviting
// someone there = making them an AREA member — a §1 bundle with channels:[]
// gift-wrapped to the invitee (CORD-05 §6), i.e. exactly what grantChannelAccess
// builds minus the private keys. Dynamic imports keep the concord dep tree out
// of SSR chunks (mirror send-message.js + the src/lib/concord convention).

/**
 * @param {any} community ConcordCommunity
 * @param {string} member invitee pubkey (hex)
 * @returns {Promise<void>}
 */
export async function directInviteToArea(community, member) {
  const { buildInviteBundle } = await import('applesauce-concord/helpers');
  const { DirectInviteFactory } = await import('applesauce-concord/factories');
  const state = community.state$?.value;
  const bundle = buildInviteBundle(community.material, {
    name: state?.metadata?.name,
    icon: state?.metadata?.icon,
    creator_npub: community.pubkey,
    channels: []
  });
  const wrap = await DirectInviteFactory.create(bundle, member, community.signer);
  community.eventStore.add(wrap);
  await community.pool
    .publish(community.relays(), wrap)
    .catch((/** @type {any} */ e) => console.warn('concord: area invite publish failed', e));
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/lib/__tests__/concord-area-invite.test.js` → 2/2 pass.

- [ ] **Step 5: Generalize `pickLatestChannelInvite`.** In `src/lib/concord/invite-helpers.js`, change the signature + filter:
```js
/**
 * @param {ConcordInviteLinkLike[] | undefined} links
 * @param {string} channelId
 * @param {boolean} [isPrivate=true] - public channels reuse the latest AREA invite (empty channels)
 * @returns {ConcordInviteLinkLike | undefined}
 */
export function pickLatestChannelInvite(links, channelId, isPrivate = true) {
  return (links ?? [])
    .filter(
      (link) =>
        !link.revoked &&
        (isPrivate ? link.channels?.includes(channelId) : !link.channels?.length)
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}
```

- [ ] **Step 6: Extend the invite-helpers test.** In `src/lib/__tests__/concord-invite-helpers.test.js`, add cases (reuse the file's existing link-fixture shape):
```js
it('matches by channel id for a private channel (default)', () => {
  const links = [{ channels: ['chA'], revoked: false, createdAt: 2 }, { channels: ['chB'], revoked: false, createdAt: 3 }];
  expect(pickLatestChannelInvite(links, 'chA')?.createdAt).toBe(2);
});
it('reuses the latest AREA invite (empty channels) for a public channel', () => {
  const links = [
    { channels: [], revoked: false, createdAt: 5 },
    { channels: ['chA'], revoked: false, createdAt: 9 },
    { channels: [], revoked: false, createdAt: 7 }
  ];
  expect(pickLatestChannelInvite(links, 'general', false)?.createdAt).toBe(7);
});
it('ignores revoked area invites for a public channel', () => {
  const links = [{ channels: [], revoked: true, createdAt: 9 }, { channels: [], revoked: false, createdAt: 4 }];
  expect(pickLatestChannelInvite(links, 'general', false)?.createdAt).toBe(4);
});
```
(Confirm the existing tests still pass — the default `isPrivate=true` preserves current behavior.)

- [ ] **Step 7: Run both test files.** `npx vitest run src/lib/__tests__/concord-area-invite.test.js src/lib/__tests__/concord-invite-helpers.test.js` → all pass.

- [ ] **Step 8: Commit.**
```bash
git add src/lib/concord/area-invite.js src/lib/concord/invite-helpers.js src/lib/__tests__/concord-area-invite.test.js src/lib/__tests__/concord-invite-helpers.test.js
git commit -m "feat(concord): area direct-invite helper + public-channel invite matching"
```

---

### Task 2: Route ChannelInviteSheet through area invites for public channels

**Files:** Modify `src/lib/components/community/channels/ChannelInviteSheet.svelte`; Modify `src/lib/components/__tests__/ChannelInviteSheet.test.js`

**Interfaces — Consumes:** `directInviteToArea` (dynamic import), `pickLatestChannelInvite(links, id, isPrivate)`.

- [ ] **Step 1: Write failing tests (append to `ChannelInviteSheet.test.js`).** Add a mock for the area-invite helper near the other `vi.mock`s:
```js
const directInviteToArea = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/concord/area-invite.js', () => ({ directInviteToArea }));
```
Then add a describe block. Reuse the file's existing render setup (community with `grantChannelAccess`, a channel object). Render once with a PUBLIC channel and once with a PRIVATE channel:
```js
describe('ChannelInviteSheet public vs private routing', () => {
  beforeEach(() => { directInviteToArea.mockClear(); grantChannelAccess.mockClear(); });

  it('public channel: direct invite routes to directInviteToArea, not grantChannelAccess', async () => {
    renderSheet({ channel: { channel_id: 'general', name: 'general', private: false } }); // adapt to file's render
    await fireEvent.click(await screen.findByRole('button', { name: /Direkt einladen|Direct/ }));
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(directInviteToArea).toHaveBeenCalled());
    expect(grantChannelAccess).not.toHaveBeenCalled();
  });

  it('private channel: direct invite uses grantChannelAccess(channelId, pubkey)', async () => {
    renderSheet({ channel: { channel_id: 'c2', name: 'ideen', private: true } });
    await fireEvent.click(await screen.findByRole('button', { name: /Direkt einladen|Direct/ }));
    await fireEvent.click(await screen.findByTestId('stub-raw-a'));
    await waitFor(() => expect(grantChannelAccess).toHaveBeenCalledWith('c2', 'a'.repeat(64)));
    expect(directInviteToArea).not.toHaveBeenCalled();
  });

  it('public channel: link mint requests an AREA invite (channels: [])', async () => {
    const createInvite = vi.fn(() => Promise.resolve({ url: 'http://x/invite/abc' }));
    renderSheet({ channel: { channel_id: 'general', name: 'general', private: false }, createInvite });
    await waitFor(() => expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({ channels: [] })));
  });
});
```
Adapt `renderSheet` to the file's existing render/mocks (the `getConcordClient().invites.forCommunity` mock, `createChannelInviteOnce` — note `createChannelInviteOnce` calls `community.createInvite`, so asserting on a `community.createInvite` mock is the cleanest way to check `channels`). If the file currently hard-mocks `createChannelInviteOnce`, assert the `channels` argument there instead. Keep assertions on real routing behavior.

- [ ] **Step 2: Run to verify fail.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelInviteSheet.test.js` → new tests FAIL.

- [ ] **Step 3: Fix the link effect (lines ~64-84).** Change the existing-invite lookup and the mint:
```js
    const existing = pickLatestChannelInvite(
      client.invites.forCommunity(community.communityId),
      channel.channel_id,
      channel.private
    );
    if (existing) {
      invite = existing;
      return;
    }
    createChannelInviteOnce(community, channel.private ? channel.channel_id : 'area', {
      base: window.location.origin,
      label: channel.name,
      channels: channel.private ? [channel.channel_id] : []
    })
```
(Only the `pickLatestChannelInvite` third arg, the `createChannelInviteOnce` dedup key, and the `channels` field change; the `.then/.catch` stay.)

- [ ] **Step 4: Route `directInvite` by visibility (lines ~116-130).** Replace the single `grantChannelAccess` call:
```js
  async function directInvite(pubkey) {
    try {
      if (channel.private) {
        await community.grantChannelAccess(channel.channel_id, pubkey);
      } else {
        const { directInviteToArea } = await import('$lib/concord/area-invite.js');
        await directInviteToArea(community, pubkey);
      }
      sent = [...sent, pubkey];
      showToast(m.concord_direct_invite_sent(), 'success');
    } catch (error) {
      console.error('concord: direct invite failed', error);
      showToast(m.concord_direct_invite_failed(), 'error');
    }
  }
```

- [ ] **Step 5: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelInviteSheet.test.js` → all pass.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/components/community/channels/ChannelInviteSheet.svelte src/lib/components/__tests__/ChannelInviteSheet.test.js
git commit -m "fix(concord): invite sheet uses area invites for public channels"
```

---

### Task 3: Route ChannelCreateWizard invitee grants by visibility

**Files:** Modify `src/lib/components/community/channels/ChannelCreateWizard.svelte`; Modify `src/lib/components/__tests__/ChannelCreateWizard.test.js`

- [ ] **Step 1: Write failing test (append to `ChannelCreateWizard.test.js`).** Add the area-invite mock near the other `vi.mock`s:
```js
const directInviteToArea = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/concord/area-invite.js', () => ({ directInviteToArea }));
```
Then, reusing the file's existing `makeCommunity`/walk helpers and the `ContactSearchInputStub`, add:
```js
it('public channel: invitee from step 2 goes through directInviteToArea', async () => {
  const community = makeCommunity(); // { createChannel -> 'new-chan', grantChannelAccess }
  render(ChannelCreateWizard, { props: { communikeyEvent: { pubkey: PUBKEY }, community, onClose: () => {}, onCreated: () => {} } });
  const nameInput = screen.getByPlaceholderText(/Staff room|Lehrer/);
  await fireEvent.input(nameInput, { target: { value: 'Open room' } });
  await fireEvent.click(screen.getByTestId('concord-visibility-public'));
  await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 1
  await fireEvent.click(await screen.findByTestId('stub-raw-a'));               // pick a member
  await fireEvent.click(screen.getByRole('button', { name: /Next|Weiter/ })); // → step 2
  await fireEvent.click(screen.getByTestId('concord-wizard-ack-checkbox'));
  await fireEvent.click(screen.getByTestId('concord-wizard-create'));
  await waitFor(() => expect(directInviteToArea).toHaveBeenCalledWith(community, 'a'.repeat(64)));
  expect(community.grantChannelAccess).not.toHaveBeenCalled();
});
```
(The existing private-channel test already asserts `grantChannelAccess` is used — keep it.)

- [ ] **Step 2: Run to verify fail.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelCreateWizard.test.js` → new test FAILS.

- [ ] **Step 3: Route the invitee loop in `create()` (lines ~87-95).** Replace the grant call inside the loop:
```js
      for (const pubkey of selected) {
        try {
          if (isPrivate) {
            await target.grantChannelAccess(channelId, pubkey);
          } else {
            const { directInviteToArea } = await import('$lib/concord/area-invite.js');
            await directInviteToArea(target, pubkey);
          }
        } catch (error) {
          console.error('concord: invite failed for', pubkey, error);
          failed++;
        }
      }
```
(Everything else in `create()` — founding, `channelId` creation, partial-failure toast — unchanged.)

- [ ] **Step 4: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelCreateWizard.test.js` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/components/community/channels/ChannelCreateWizard.svelte src/lib/components/__tests__/ChannelCreateWizard.test.js
git commit -m "fix(concord): create wizard uses area invites for public channels"
```

---

### Task 4: Verification (incl. real end-to-end invite)

**Files:** none

- [ ] **Step 1: Typecheck.** `pnpm check 2>&1 | grep -E "area-invite|invite-helpers|ChannelInviteSheet|ChannelCreateWizard"` → no ERROR lines.
- [ ] **Step 2: Full invite/concord suite.** `npx vitest run src/lib/__tests__/concord-area-invite.test.js src/lib/__tests__/concord-invite-helpers.test.js` and `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelInviteSheet.test.js src/lib/components/__tests__/ChannelCreateWizard.test.js` → all pass.
- [ ] **Step 3: Browser E2E (controller-driven).** On the live area's `# general` channel: open Einladen → Link & QR renders a link with no console error (`concord: createInvite failed` must NOT appear); Direkt einladen → paste/pick **laoc42** → click invite → expect the "Einladung gesendet" success toast and NO error toast/console error. Then verify a private channel (`🔒 willkommen`) still invites via grantChannelAccess without error.
- [ ] **Step 4: Final commit if fixes were needed** (skip if clean).

## Self-Review

- **Spec coverage:** area helper → Task 1; link `channels:[]` + reuse → Task 2; direct routing → Task 2; wizard routing → Task 3; tests + real E2E → each task + Task 4. ✓
- **Type/name consistency:** `directInviteToArea(community, member)`, `pickLatestChannelInvite(links, channelId, isPrivate)`, `channel.private`, `isPrivate` used identically across tasks and match current source. ✓
- **Placeholder scan:** helper + component code concrete; the two component test steps say "adapt `renderSheet`/reuse existing helpers" (harness reuse), not blanks, and forbid weakening the routing assertions. ✓
- **Scope:** no SDK/relay/protocol changes; dynamic-import convention honored; no MANAGE_CHANNELS gate added (matches link-invite openness). ✓
