/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const ADMIN_PUBKEY = 'a'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN_PUBKEY}:edufeed-membership`;

/** @type {{ events: any[] }} */
const timelineState = { events: [] };

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return {
        enabled: true,
        handleDomain: 'edufeed.org',
        formAddress: FORM_ADDRESS,
        adminPubkeys: [ADMIN_PUBKEY]
      };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: { pubkey: 'user-pub', signer: {} }
  }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: () => {},
    replaceable: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    timeline: (/** @type {any} */ _filter) => ({
      subscribe(/** @type {(events: any[]) => void} */ cb) {
        cb(timelineState.events);
        return { unsubscribe: () => {} };
      }
    })
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  timedPool: () => ({})
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => [],
  getAllLookupRelays: () => []
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: vi.fn(), sign: vi.fn() })
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async () => ({ success: true }))
}));

import MembershipCard from '../MembershipCard.svelte';

describe('MembershipCard', () => {
  beforeEach(() => {
    timelineState.events = [];
  });

  it('shows CTA when no application exists', () => {
    const { getByRole } = render(MembershipCard);
    expect(
      getByRole('button', { name: /Mitgliedschaft beantragen|Apply.*membership/i })
    ).toBeTruthy();
  });

  it('shows submitted-on text when an application exists', () => {
    timelineState.events = [
      {
        id: 'response-id',
        kind: 1069,
        pubkey: 'user-pub',
        created_at: 1700000000,
        tags: [['a', FORM_ADDRESS]],
        content: '',
        sig: 'sig'
      }
    ];
    const { getByText } = render(MembershipCard);
    // Either German "Antrag eingereicht" or English "submitted an application"
    expect(getByText(/eingereicht|submitted/i)).toBeTruthy();
  });

  it('does not render when membership is disabled', async () => {
    const cfgModule = await import('$lib/stores/config.svelte.js');
    // override the getter via direct mock manipulation
    Object.defineProperty(cfgModule.runtimeConfig, 'membership', {
      configurable: true,
      get() {
        return { enabled: false, handleDomain: '', formAddress: '', adminPubkeys: [] };
      }
    });
    const { container } = render(MembershipCard);
    expect(container.textContent?.trim()).toBe('');
    // restore default
    Object.defineProperty(cfgModule.runtimeConfig, 'membership', {
      configurable: true,
      get() {
        return {
          enabled: true,
          handleDomain: 'edufeed.org',
          formAddress: FORM_ADDRESS,
          adminPubkeys: [ADMIN_PUBKEY]
        };
      }
    });
  });
});
