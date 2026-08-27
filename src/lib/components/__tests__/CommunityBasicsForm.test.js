/** @vitest-environment jsdom */
/**
 * CommunityBasicsForm.save() must hand the community signer a
 * structured-cloneable 10222. The template reuses the source event's pointer
 * tags verbatim (preservePointerTags), and those live in Svelte $state as deep
 * reactive proxies. A NIP-07 extension signer serialises via
 * window.postMessage → structuredClone, which throws DataCloneError on a proxy.
 * Regression guard for the live bug (laoc 2026-08-20: "Error updating
 * community: DataCloneError ... at CommunityBasicsForm.svelte save").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);

// Extension-style signer: does what nostr-provider.js does — round-trips the
// template through structuredClone (the postMessage boundary) before signing.
// Throws DataCloneError on a Svelte proxy, succeeds on a plain object.
const extensionSigner = vi.hoisted(() => ({
  signEvent: vi.fn(async (/** @type {any} */ template) => {
    structuredClone(template); // throws on a reactive proxy
    return { ...template, id: 'signed', sig: 'x', pubkey: OWNER };
  })
}));
vi.mock('$lib/helpers/community-signer.js', () => ({
  getCommunitySigner: () => extensionSigner,
  isCommunityOwner: () => true
}));

const publishEventOptimistic = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic }));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toastSpy }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    replaceable: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
  },
  pool: {}
}));
vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

const syncRootGroupMetadataWithFallback = vi.hoisted(() =>
  vi.fn(async () => /** @type {{ok: boolean, error?: string}} */ ({ ok: true }))
);
vi.mock('$lib/groups/sync-group-metadata.js', () => ({
  syncRootGroupMetadata: vi.fn(),
  syncRootGroupMetadataWithFallback
}));

// The community's own kind-0, as the profile-row preview reads it.
const communityProfile = vi.hoisted(() => ({ value: /** @type {any} */ (null) }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => communityProfile.value
}));

const { default: CommunityBasicsForm } = await import(
  '$lib/components/community/settings/CommunityBasicsForm.svelte'
);

// A stand-in for a Svelte $state deep proxy: a Proxy whose get trap makes
// structuredClone (and thus postMessage) throw, exactly like the runtime one.
/** @param {string[]} arr */
function reactiveTag(arr) {
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === Symbol.for('svelte-proxy')) return true;
      return Reflect.get(target, prop, receiver);
    }
  });
}

describe('CommunityBasicsForm — save de-proxies before signing', () => {
  beforeEach(() => {
    extensionSigner.signEvent.mockClear();
    publishEventOptimistic.mockClear();
    toastSpy.mockClear();
  });

  it('hands the extension signer a structured-cloneable template (no DataCloneError)', async () => {
    // A moderated community: the membership pointer is preserved verbatim by
    // preservePointerTags, so its reactive-proxy entry reaches the template —
    // exactly the runtime path that crashed.
    const communikeyEvent = {
      kind: 10222,
      id: 'evt1',
      pubkey: OWNER,
      created_at: 1000,
      content: 'desc',
      tags: [
        reactiveTag(['d', 'edufeed']),
        reactiveTag(['name', 'My Community']),
        reactiveTag(['r', 'wss://relay.edufeed.org']),
        reactiveTag(['membership', 'root1', 'wss://groups.edufeed.org'])
      ]
    };

    render(CommunityBasicsForm, { props: { communikeyEvent } });

    await fireEvent.click(await screen.findByTestId('basics-save'));

    // The signer was called, and the template it received is cloneable.
    await waitFor(() => expect(extensionSigner.signEvent).toHaveBeenCalled());
    const passed = extensionSigner.signEvent.mock.calls[0][0];
    expect(() => structuredClone(passed)).not.toThrow();
    // The preserved membership pointer is present and de-proxied.
    expect(passed.tags).toEqual(
      expect.arrayContaining([['membership', 'root1', 'wss://groups.edufeed.org']])
    );

    // Save succeeded end-to-end: published + success toast, no error toast.
    await waitFor(() => expect(publishEventOptimistic).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'success');
  });
});

// The community description has one home — the kind-0 profile (see
// getCommunityAbout). The card used to offer a second, inline one writing a
// 10222 `description` tag that only the ICS export ever read, labelled as if
// it overrode the profile text. Removed: one field, one source.
describe('CommunityBasicsForm — single description source', () => {
  beforeEach(() => {
    extensionSigner.signEvent.mockClear();
    publishEventOptimistic.mockClear();
    toastSpy.mockClear();
  });

  /** @param {string[][]} tags */
  const eventWith = (tags) => ({
    kind: 10222,
    id: 'evt-desc',
    pubkey: OWNER,
    created_at: 1000,
    content: '',
    tags: [['d', 'edufeed'], ['name', 'My Community'], ...tags]
  });

  it('renders no inline description textarea', async () => {
    render(CommunityBasicsForm, { props: { communikeyEvent: eventWith([]) } });
    await screen.findByTestId('basics-save');
    expect(screen.queryByTestId('basics-description')).toBeNull();
    expect(document.querySelector('#basics-description')).toBeNull();
  });

  it('drops a legacy description tag on save instead of round-tripping it', async () => {
    render(CommunityBasicsForm, {
      props: { communikeyEvent: eventWith([['description', 'legacy override text']]) }
    });
    await fireEvent.click(await screen.findByTestId('basics-save'));
    await waitFor(() => expect(extensionSigner.signEvent).toHaveBeenCalled());
    const passed = extensionSigner.signEvent.mock.calls[0][0];
    expect(passed.tags.some((/** @type {string[]} */ t) => t[0] === 'description')).toBe(false);
  });

  it('keeps the location tag (it is displayed on the community hero)', async () => {
    render(CommunityBasicsForm, {
      props: { communikeyEvent: eventWith([['location', 'Bremen, Deutschland']]) }
    });
    await fireEvent.click(await screen.findByTestId('basics-save'));
    await waitFor(() => expect(extensionSigner.signEvent).toHaveBeenCalled());
    const passed = extensionSigner.signEvent.mock.calls[0][0];
    expect(passed.tags).toEqual(expect.arrayContaining([['location', 'Bremen, Deutschland']]));
  });
});

// With the inline description gone, the profile row is the only place
// name/picture/description are edited — so it shows what it owns instead of
// being a bare button (laoc, 2026-08-21).
describe('CommunityBasicsForm — profile row preview', () => {
  it('previews the community name and description next to the edit button', async () => {
    communityProfile.value = {
      name: 'Musterschule',
      about: 'Wir lernen gemeinsam',
      picture: 'https://example.org/pic.jpg'
    };
    render(CommunityBasicsForm, {
      props: {
        communikeyEvent: {
          kind: 10222,
          id: 'evt-preview',
          pubkey: OWNER,
          created_at: 1000,
          content: '',
          tags: [['d', 'edufeed']]
        }
      }
    });
    await screen.findByTestId('basics-edit-profile');
    expect(screen.getByText('Musterschule')).toBeTruthy();
    expect(screen.getByText('Wir lernen gemeinsam')).toBeTruthy();
  });
});

// Saving from the settings card must refresh the linked NIP-29 group's 39000
// too — not only the profile modal (laoc, 2026-08-21). It carries the current
// kind-0 fields, so it doubles as the repair action for a group whose metadata
// went stale.
describe('CommunityBasicsForm — group metadata re-sync on save', () => {
  beforeEach(() => {
    extensionSigner.signEvent.mockClear();
    publishEventOptimistic.mockClear();
    toastSpy.mockClear();
    syncRootGroupMetadataWithFallback.mockClear().mockResolvedValue({ ok: true });
    communityProfile.value = {
      name: 'Musterschule',
      about: 'Wir lernen gemeinsam',
      picture: 'https://example.org/pic.jpg'
    };
  });

  const MODERATED = {
    kind: 10222,
    id: 'evt-sync',
    pubkey: OWNER,
    created_at: 1000,
    content: '',
    tags: [
      ['d', 'edufeed'],
      ['membership', 'root1', 'wss://groups.edufeed.org']
    ]
  };

  it('re-issues the 9002 with the current profile after the 10222 publishes', async () => {
    render(CommunityBasicsForm, { props: { communikeyEvent: MODERATED } });
    await fireEvent.click(await screen.findByTestId('basics-save'));

    await waitFor(() => expect(syncRootGroupMetadataWithFallback).toHaveBeenCalledOnce());
    const [args] = /** @type {any[]} */ (syncRootGroupMetadataWithFallback.mock.calls[0]);
    expect(args.pointer).toEqual({ id: 'root1', relay: 'wss://groups.edufeed.org' });
    expect(args.profile).toEqual({
      name: 'Musterschule',
      about: 'Wir lernen gemeinsam',
      picture: 'https://example.org/pic.jpg'
    });
    expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('attempts no group write for an open community (no membership pointer)', async () => {
    render(CommunityBasicsForm, {
      props: { communikeyEvent: { ...MODERATED, id: 'evt-open', tags: [['d', 'edufeed']] } }
    });
    await fireEvent.click(await screen.findByTestId('basics-save'));
    await waitFor(() => expect(publishEventOptimistic).toHaveBeenCalled());
    // The skip is the helper's job (it returns {skipped:true} on a null
    // pointer), so the card passes what it has instead of branching twice.
    const [args] = /** @type {any[]} */ (syncRootGroupMetadataWithFallback.mock.calls[0] ?? [{}]);
    expect(args.pointer).toBeNull();
  });

  it('warns but still reports the save as successful when the relay refuses', async () => {
    syncRootGroupMetadataWithFallback.mockResolvedValue({ ok: false, error: 'restricted' });
    render(CommunityBasicsForm, { props: { communikeyEvent: MODERATED } });
    await fireEvent.click(await screen.findByTestId('basics-save'));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'warning'));
    expect(toastSpy).toHaveBeenCalledWith(expect.anything(), 'success');
  });
});

// A moderated community's content lives on a NIP-29 relay that appears nowhere
// else in the UI — the advanced section names it so owners can see which relay
// holds their group (laoc, 2026-08-21). Read-only: moving a group between
// relays is not an edit, it is a re-founding.
describe('CommunityBasicsForm — group relay info', () => {
  beforeEach(() => {
    toastSpy.mockClear();
    communityProfile.value = { name: 'Musterschule' };
  });

  it('shows the per-community endpoint, not the bare host, plus the host it lives on', async () => {
    render(CommunityBasicsForm, {
      props: {
        communikeyEvent: {
          kind: 10222,
          id: 'evt-relay',
          pubkey: OWNER,
          created_at: 1000,
          content: '',
          tags: [
            ['d', 'edufeed'],
            ['membership', 'root1', 'wss://groups.edufeed.org']
          ]
        }
      }
    });
    // wss://host/c/<rootId> is the address other clients (Armada) open the
    // community with — its NIP-11 carries the community's own name/about/icon.
    // The bare host is only the write target for creates + moderation.
    const info = await screen.findByTestId('basics-group-relay');
    expect(info.textContent).toContain('wss://groups.edufeed.org/c/root1');
    expect(info.textContent).toContain('groups.edufeed.org');
  });

  it('shows nothing for an open community (no group)', async () => {
    render(CommunityBasicsForm, {
      props: {
        communikeyEvent: {
          kind: 10222,
          id: 'evt-open-relay',
          pubkey: OWNER,
          created_at: 1000,
          content: '',
          tags: [['d', 'edufeed']]
        }
      }
    });
    await screen.findByTestId('basics-save');
    expect(screen.queryByTestId('basics-group-relay')).toBeNull();
  });
});
