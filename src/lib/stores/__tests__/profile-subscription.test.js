/**
 * Unit tests for subscribeProfile — the per-pubkey primitive that wires a
 * profileLoader fetch to an eventStore ProfileModel subscription.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

const profileLoaderMock = vi.fn();
const modelMock = vi.fn();

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: (/** @type {any[]} */ ...args) => profileLoaderMock(...args)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (/** @type {any[]} */ ...args) => modelMock(...args)
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://purplepag.es', 'wss://relay.example.com']
}));

vi.mock('applesauce-core/models', () => ({
  ProfileModel: 'ProfileModel'
}));

const { subscribeProfile } = await import('../profile-subscription.js');

describe('subscribeProfile', () => {
  /** @type {Subject<any>} */
  let loaderSubject;
  /** @type {Subject<any>} */
  let modelSubject;
  let loaderUnsubscribed = false;
  let modelUnsubscribed = false;

  beforeEach(() => {
    loaderSubject = new Subject();
    modelSubject = new Subject();
    loaderUnsubscribed = false;
    modelUnsubscribed = false;

    profileLoaderMock.mockReset();
    modelMock.mockReset();

    profileLoaderMock.mockImplementation(() => ({
      subscribe: (/** @type {any} */ obs) => {
        const sub = loaderSubject.subscribe(obs);
        const orig = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
          loaderUnsubscribed = true;
          orig();
        };
        return sub;
      }
    }));

    modelMock.mockImplementation(() => ({
      subscribe: (/** @type {any} */ obs) => {
        const sub = modelSubject.subscribe(obs);
        const orig = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
          modelUnsubscribed = true;
          orig();
        };
        return sub;
      }
    }));
  });

  it('invokes profileLoader once with kind 0, pubkey, and getProfileLookupRelays()', () => {
    const pubkey = 'pk-abc123';
    subscribeProfile(pubkey, () => {});

    expect(profileLoaderMock).toHaveBeenCalledTimes(1);
    expect(profileLoaderMock).toHaveBeenCalledWith({
      kind: 0,
      pubkey,
      relays: ['wss://purplepag.es', 'wss://relay.example.com']
    });
  });

  it('subscribes to eventStore.model(ProfileModel, pubkey) and forwards emissions to callback', () => {
    const pubkey = 'pk-xyz';
    const cb = vi.fn();
    subscribeProfile(pubkey, cb);

    expect(modelMock).toHaveBeenCalledWith('ProfileModel', pubkey);

    const profile = { name: 'Test User', picture: 'https://example.com/pic.png' };
    modelSubject.next(profile);

    expect(cb).toHaveBeenCalledWith(profile);
  });

  it('unsubscribe() disposes both loader and model subscriptions', () => {
    const sub = subscribeProfile('pk', () => {});

    expect(loaderUnsubscribed).toBe(false);
    expect(modelUnsubscribed).toBe(false);

    sub.unsubscribe();

    expect(loaderUnsubscribed).toBe(true);
    expect(modelUnsubscribed).toBe(true);
  });
});
