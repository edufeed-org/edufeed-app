/** @vitest-environment jsdom */
/**
 * ChannelOverview — the pane a community extended by NIP-29 groups lands on.
 *
 * The rows are built by the REAL buildChannelRows from real kind:39000
 * fixtures, not hand-written row objects: the thing under test is what a
 * reader sees for a given relay state, and a hand-written row could describe a
 * state the builder never produces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
// Kind-39004 presence, stubbed per channel id: the cards only render it.
const presence = vi.hoisted(() => ({ byId: /** @type {Record<string, string[]>} */ ({}) }));
vi.mock('$lib/groups/call-presence.svelte.js', () => ({
  useCallPresence: (/** @type {() => any} */ getPointer) => () => ({
    participants: presence.byId[getPointer()?.id] ?? [],
    answered: true
  })
}));
// The community pane's cards carry the full ChannelCallRoster (join / show
// call / "you're in the call"): its call-state and account inputs, stubbed.
const call = vi.hoisted(() => ({ active: false, stageViews: 0, stageHidden: false }));
const callFns = vi.hoisted(() => ({
  joinGroupCall: vi.fn(async (/** @type {any[]} */ ..._a) => {}),
  showCallStage: vi.fn((/** @type {any[]} */ ..._a) => {})
}));
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => ({
    isActiveFor: () => call.active,
    get phase() {
      return call.active ? 'ready' : 'idle';
    },
    get stageViews() {
      return call.stageViews;
    },
    get stageHidden() {
      return call.stageHidden;
    }
  }),
  joinGroupCall: (/** @type {any[]} */ ...a) => callFns.joinGroupCall(...a),
  joinGroupCallWithConfirm: (/** @type {any[]} */ ...a) => callFns.joinGroupCall(...a),
  showCallStage: (/** @type {any[]} */ ...a) => callFns.showCallStage(...a)
}));
vi.mock('$lib/groups/call-popout.svelte.js', () => ({
  getCallPopoutState: () => ({ open: false })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64), signer: {} })
}));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
import ChannelOverview from '$lib/components/community/channels/ChannelOverview.svelte';
import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
import { channelAccessLevel } from '$lib/groups/channel-access.js';

const RELAY = 'wss://groups.example';

const ptr = (/** @type {string} */ id, /** @type {any} */ extra = {}) => ({
  id,
  relay: RELAY,
  ...extra
});
const meta = (/** @type {string} */ id, /** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', id], ...extra]
});
// A subtree channel from a pointer + its kind:39000 tags. Omit `tags` to model
// "metadata not yet arrived" (level 'unknown' → still-loading).
const sub = (/** @type {any} */ pointer, /** @type {string[][] | undefined} */ tags = undefined) =>
  /** @type {any} */ (
    tags === undefined
      ? { id: pointer.id, relay: pointer.relay, level: 'unknown', metadata: null }
      : (() => {
          const metadata = meta(pointer.id, tags);
          return {
            id: pointer.id,
            relay: pointer.relay,
            name: metadata.tags.find((t) => t[0] === 'name')?.[1],
            level: channelAccessLevel(metadata),
            metadata
          };
        })()
  );

describe('ChannelOverview', () => {
  it('says the community has no channels rather than showing an empty grid', () => {
    render(ChannelOverview, { props: { rows: [] } });
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
    expect(screen.getByText(/noch keine Kanäle|no channels yet/i)).toBeTruthy();
  });

  it('gives each channel a card that links to its group', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        sub(ptr('ankuendigungen'), [['name', 'Ankündigungen'], ['restricted']]),
        sub(ptr('leitung'), [['name', 'Leitung'], ['private']])
      ]
    });
    render(ChannelOverview, { props: { rows } });
    const cards = screen.getAllByTestId('channel-card');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.getAttribute('href'))).toEqual([
      "/groups/groups.example'ankuendigungen",
      "/groups/groups.example'leitung"
    ]);
  });

  // With onSelect (the community pane), cards pick the channel in place —
  // buttons, not links: leaving for /groups would drop the community frame
  // and load the host's whole directory (laoc, 2026-08-19).
  it('with onSelect, cards are buttons that hand back the pointer', async () => {
    const rows = buildChannelRows({
      subtreeChannels: [sub(ptr('ankuendigungen'), [['name', 'Ankündigungen'], ['restricted']])]
    });
    const onSelect = vi.fn();
    render(ChannelOverview, { props: { rows, onSelect } });
    const [card] = screen.getAllByTestId('channel-card');
    expect(card.getAttribute('href')).toBeNull();
    await fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ankuendigungen' }));
  });

  // The rail's glyph is '#' for BOTH world-readable and members-only, so a
  // card that only repeated the glyph would add nothing. These two rows share
  // the glyph and must still read differently.
  it('names the access level in words, where the glyph cannot tell two apart', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        sub(ptr('ankuendigungen'), [['restricted']]),
        sub(ptr('allgemein'), [['private']])
      ]
    });
    expect(new Set(rows.map((r) => r.symbol))).toEqual(new Set(['#']));

    render(ChannelOverview, { props: { rows } });
    const labels = screen.getAllByTestId('channel-card-access').map((n) => n.textContent?.trim());
    expect(new Set(labels).size).toBe(2);
  });

  // Metadata still in flight must never read as open.
  it('says the access is still loading for a channel with no metadata yet', () => {
    const rows = buildChannelRows({ subtreeChannels: [sub(ptr('allgemein'))] });
    render(ChannelOverview, { props: { rows } });
    expect(screen.getByTestId('channel-card-access').textContent).toMatch(
      /wird geladen|still loading/i
    );
    expect(screen.queryByTestId('world-readable-badge')).toBeNull();
  });

  it('marks only the world-readable channel with the globe', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        sub(ptr('ankuendigungen'), [['restricted']]),
        sub(ptr('allgemein'), [['private']])
      ]
    });
    render(ChannelOverview, { props: { rows } });
    expect(screen.getAllByTestId('world-readable-badge')).toHaveLength(1);
  });

  it('shows the group topic when there is one, and no empty line when there is not', () => {
    const rows = buildChannelRows({
      subtreeChannels: [
        sub(ptr('a'), [['private'], ['about', 'Alles Weitere']]),
        sub(ptr('b'), [['private']])
      ]
    });
    render(ChannelOverview, { props: { rows } });
    // Two cards, exactly ONE topic line — asserting only that the text is
    // present would pass just as well on a card that always reserves the line.
    expect(screen.getAllByTestId('channel-card')).toHaveLength(2);
    const topics = screen.getAllByTestId('channel-card-topic');
    expect(topics).toHaveLength(1);
    expect(topics[0].textContent).toBe('Alles Weitere');
  });

  it('shows what the host announces about itself, above the cards', () => {
    render(ChannelOverview, {
      props: {
        rows: [],
        hostBadges: [{ id: 'auth' }, { id: 'nip29' }, { id: 'software', text: 'pyramid 1.2' }]
      }
    });
    expect(screen.getByTestId('group-badge-auth')).toBeTruthy();
    expect(screen.getByTestId('group-badge-nip29')).toBeTruthy();
    // The relay's own self-description, never translated.
    expect(screen.getByTestId('group-badge-software').textContent?.trim()).toBe('pyramid 1.2');
  });

  it('renders no host row at all when the relay announced nothing', () => {
    render(ChannelOverview, { props: { rows: [], hostBadges: [] } });
    expect(screen.queryByTestId('group-badges')).toBeNull();
  });

  // A concord row has no `pointer`, so a card built for one would link nowhere.
  // This pane is only mounted for group-extended communities; the filter is
  // what guarantees that stays true.
  it('ignores a concord row rather than drawing a card that links nowhere', () => {
    const rows = buildChannelRows({
      concordChannels: [{ channel_id: 'c-1', name: 'Allgemein', accessible: true }]
    });
    render(ChannelOverview, { props: { rows } });
    expect(screen.queryAllByTestId('channel-card')).toHaveLength(0);
  });

  // Between md and lg there is no sidebar: these cards are the channel list,
  // so a running call shows on its card (laoc, 2026-10-02).
  it('marks a running call on an AV channel card, with the head count', () => {
    presence.byId = { sprechstunde: ['b'.repeat(64), 'c'.repeat(64)], stumm: [] };
    const rows = buildChannelRows({
      subtreeChannels: [
        sub(ptr('sprechstunde'), [['name', 'sprechstunde'], ['livekit']]),
        sub(ptr('stumm'), [['name', 'stumm'], ['livekit']]),
        sub(ptr('text'), [['name', 'text']])
      ]
    });
    render(ChannelOverview, { props: { rows } });
    const badges = screen.getAllByTestId('channel-card-call');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('[data-testid="channel-card"]')?.textContent).toContain(
      'sprechstunde'
    );
    expect(badges[0].textContent).toMatch(/2 (im Anruf|in the call)/);
    // Design 1a: the same soft success pill as the channel lists.
    expect(badges[0].className).toContain('badge-soft');
    expect(badges[0].className).toContain('badge-success');
    presence.byId = {};
  });

  // C-new-7 (QA 2026-10-02): the cards are now THE channel list at every
  // width — so the rail's per-channel star and admin delete live on the card,
  // as siblings of the card button (never nested inside it).
  describe('per-card actions', () => {
    const rows = () =>
      buildChannelRows({
        rootChannel: sub(ptr('root0'), [['name', 'laoc42']]),
        rootLabel: 'Allgemein',
        subtreeChannels: [sub(ptr('willkommen'), [['name', 'willkommen']])]
      });

    it('draws no actions unless the caller asks for them', () => {
      render(ChannelOverview, { props: { rows: rows(), onSelect: () => {} } });
      expect(screen.queryByTestId('channel-favourite-toggle')).toBeNull();
      expect(screen.queryByTestId('group-channel-delete')).toBeNull();
    });

    it('stars a card and deletes only where canDelete allows, outside the card button', async () => {
      const toggled = /** @type {string[]} */ ([]);
      const deleted = /** @type {string[]} */ ([]);
      render(ChannelOverview, {
        props: {
          rows: rows(),
          onSelect: () => {},
          isFavourite: (/** @type {any} */ row) => row.pointer.id === 'willkommen',
          onToggleFavourite: (/** @type {any} */ row) => toggled.push(row.pointer.id),
          canDelete: (/** @type {any} */ row) => row.pointer.id !== 'root0',
          onDelete: (/** @type {any} */ pointer) => deleted.push(pointer.id)
        }
      });
      const stars = screen.getAllByTestId('channel-favourite-toggle');
      expect(stars).toHaveLength(2);
      expect(stars.map((s) => s.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      for (const star of stars) expect(star.closest('[data-testid="channel-card"]')).toBeNull();
      await fireEvent.click(stars[0]);
      expect(toggled).toEqual(['root0']);

      const deletes = screen.getAllByTestId('group-channel-delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].closest('[data-testid="channel-card"]')).toBeNull();
      await fireEvent.click(deletes[0]);
      expect(deleted).toEqual(['willkommen']);
    });
  });

  // Fix round 1 (controller ruling): the phone rail's roster under AV rows —
  // one-click join, "Anruf anzeigen", "Du bist im Anruf · N" — must not be
  // lost now that the cards are the list. In the community pane (onSelect)
  // each running AV card carries the full roster, as a sibling of the card
  // button. The relay directory (no onSelect) keeps the passive pill.
  describe('running-call roster on the community cards', () => {
    const avRows = () =>
      buildChannelRows({
        subtreeChannels: [
          sub(ptr('sprechstunde'), [['name', 'sprechstunde'], ['livekit']]),
          sub(ptr('text'), [['name', 'text']])
        ]
      });

    /** @param {() => void} [onSelect] */
    function renderPane(onSelect = vi.fn()) {
      presence.byId = { sprechstunde: ['b'.repeat(64), 'c'.repeat(64)] };
      render(ChannelOverview, { props: { rows: avRows(), onSelect } });
      const rosters = screen.getAllByTestId('channel-call-roster');
      expect(rosters).toHaveLength(1);
      expect(rosters[0].closest('[data-testid="channel-card"]')).toBeNull();
      expect(rosters[0].closest('[data-testid="channel-card-wrap"]')?.textContent).toContain(
        'sprechstunde'
      );
      return rosters[0];
    }

    beforeEach(() => {
      call.active = false;
      call.stageViews = 0;
      call.stageHidden = false;
      callFns.joinGroupCall.mockClear();
      callFns.showCallStage.mockClear();
    });

    // Task 18 follow-up: the pill + avatars row IS the control now — no
    // separate text link nested inside it.
    it('not in the call: Join opens the channel, then joins its call', async () => {
      const onSelect = vi.fn();
      const roster = renderPane(onSelect);
      expect(roster.tagName).toBe('BUTTON');
      expect(roster.getAttribute('aria-label')).toMatch(/Join|Laufendem Anruf|beitreten/i);
      await fireEvent.click(roster);
      await vi.waitFor(() => expect(callFns.joinGroupCall).toHaveBeenCalled());
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sprechstunde' }));
    });

    it('in the call, stage not on screen: "Show call" brings it back', async () => {
      call.active = true;
      const onSelect = vi.fn();
      const roster = renderPane(onSelect);
      expect(roster.tagName).toBe('BUTTON');
      await fireEvent.click(roster);
      expect(callFns.showCallStage).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(callFns.joinGroupCall).not.toHaveBeenCalled();
    });

    it('in the call with its stage on screen: the status line, no button', () => {
      call.active = true;
      call.stageViews = 1;
      const roster = renderPane();
      expect(within(roster).queryByRole('button')).toBeNull();
      expect(within(roster).getByTestId('channel-call-roster-here').textContent).toMatch(/2/);
    });

    it('the relay directory (no onSelect) keeps the passive pill, no roster', () => {
      presence.byId = { sprechstunde: ['b'.repeat(64)] };
      render(ChannelOverview, { props: { rows: avRows() } });
      expect(screen.queryByTestId('channel-call-roster')).toBeNull();
      expect(screen.getAllByTestId('channel-card-call')).toHaveLength(1);
    });
  });
});
