/** @vitest-environment jsdom */
/**
 * ChannelOverview — the pane a community extended by NIP-29 groups lands on.
 *
 * The rows are built by the REAL buildChannelRows from real kind:39000
 * fixtures, not hand-written row objects: the thing under test is what a
 * reader sees for a given relay state, and a hand-written row could describe a
 * state the builder never produces.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
});
