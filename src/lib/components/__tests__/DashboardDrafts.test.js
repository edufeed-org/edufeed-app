/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const cfg = vi.hoisted(() => ({ termi: { llm: true } }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: cfg }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: {} }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({ getWriteRelays: async () => [] }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: vi.fn() }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));

const { default: DashboardDrafts } = await import('../dashboard/DashboardDrafts.svelte');
const PK = 'b'.repeat(64);
const conv = (/** @type {string} */ id, /** @type {any} */ extra = {}) => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 5,
  messages: [],
  ...extra
});

describe('DashboardDrafts', () => {
  beforeEach(() => {
    localStorage.clear();
    cfg.termi.llm = true;
  });

  it('lists the drafts as ?termi=<id> links and ignores plain conversations', async () => {
    localStorage.setItem(
      'termi.conversations.' + PK,
      JSON.stringify([
        conv('s1', { lesson: { phase: 2, frame: { topic: 'Brüche' } } }),
        conv('s2', { lesson: { phase: 2 } }),
        conv('plain'),
        // a long ask answer is no draft until the Werkbank saved it as a document
        conv('long', { messages: [{ id: 'l', role: 'assistant', content: '# Titel\n\nText' }] }),
        conv('doc', {
          messages: [
            { id: 'd', role: 'assistant', content: '# Handout …', draftWraps: { document: 'n' } }
          ]
        })
      ])
    );
    const view = render(DashboardDrafts, { props: { pubkey: PK } });
    await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(3));
    const hrefs = view.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['?termi=doc', '?termi=s1', '?termi=s2']);
  });

  it('renders nothing without drafts, without a user, or with Termi AI off', async () => {
    const empty = render(DashboardDrafts, { props: { pubkey: PK } });
    await new Promise((r) => setTimeout(r, 20));
    expect(empty.queryByTestId('dashboard-drafts')).toBeNull();
    localStorage.setItem('termi.conversations.' + PK, JSON.stringify([conv('s1', { lesson: {} })]));
    const anon = render(DashboardDrafts, { props: { pubkey: undefined } });
    cfg.termi.llm = false;
    const off = render(DashboardDrafts, { props: { pubkey: PK } });
    await new Promise((r) => setTimeout(r, 20));
    expect(anon.queryByTestId('dashboard-drafts')).toBeNull();
    expect(off.queryByTestId('dashboard-drafts')).toBeNull();
  });

  it('empties when the user logs out (pubkey goes away)', async () => {
    localStorage.setItem('termi.conversations.' + PK, JSON.stringify([conv('s1', { lesson: {} })]));
    const view = render(DashboardDrafts, { props: { pubkey: PK } });
    await waitFor(() => view.getByTestId('dashboard-drafts'));
    await view.rerender({ pubkey: undefined });
    expect(view.queryByTestId('dashboard-drafts')).toBeNull();
  });
});
