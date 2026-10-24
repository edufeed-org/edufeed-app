/**
 * NIP-23 drafts (kind 30024) live on the longform relays like articles —
 * the relay category drives publishing, deletion and link previews.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Test', appRelays: {} },
  configReady: { subscribe: () => () => {} }
}));

const { kindToAppRelayCategory } = await import('$lib/services/app-relay-service.svelte.js');

describe('kindToAppRelayCategory', () => {
  it('maps kind 30024 drafts to longform like kind 30023', () => {
    expect(kindToAppRelayCategory(30024)).toBe('longform');
    expect(kindToAppRelayCategory(30023)).toBe('longform');
  });
});
