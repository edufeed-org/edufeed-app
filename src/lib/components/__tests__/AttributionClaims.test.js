// @ts-nocheck
/**
 * AttributionClaims — "Das bin ich" for the named person, the pending line
 * with withdraw, and the publisher's list of open claims.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { BehaviorSubject, of } from 'rxjs';

const PUBLISHER = 'a'.repeat(64);
const PAULA = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);

const state = vi.hoisted(() => ({
  user: /** @type {any} */ (null),
  claims$: /** @type {any} */ (null),
  latest: /** @type {any} */ (undefined)
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  common_cancel: () => 'Abbrechen',
  amb_resource_role_creator: () => 'Urheber:in',
  amb_resource_role_contributor: () => 'Mitwirkende:r',
  attribution_claim_button: () => 'Das bin ich',
  attribution_claim_choose: () => 'Welche Nennung bist du?',
  attribution_claim_explain: () => 'Die veröffentlichende Person muss bestätigen.',
  attribution_claim_send: () => 'Anfrage senden',
  attribution_claim_sent_toast: () => 'Anfrage gesendet',
  attribution_claim_pending: ({ name }) => `Anfrage gesendet – wartet auf Bestätigung (${name})`,
  attribution_claim_withdraw: () => 'Zurückziehen',
  attribution_claims_heading: () => 'Offene Anfragen',
  attribution_claim_request: ({ name }) => `möchte als «${name}» verknüpft werden`,
  attribution_claim_confirm: () => 'Bestätigen',
  attribution_claim_error: () => 'Das hat nicht geklappt.'
}));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ profileLink: (pk) => `/p/${pk}` }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast.js', () => ({ showToast }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => state.user }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([['b'.repeat(64), { name: 'Paula Profil' }]])
}));
const useAuthorDeletions = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/author-deletions.svelte.js', () => ({ useAuthorDeletions }));
const fetchEvents = vi.hoisted(() => vi.fn());
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents }));
const eventStore = vi.hoisted(() => ({ model: vi.fn(), replaceable: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore }));
const io = vi.hoisted(() => ({
  claimRelays: vi.fn(() => ['wss://amb.example/']),
  publishClaim: vi.fn(),
  acceptClaim: vi.fn(),
  withdrawClaim: vi.fn()
}));
vi.mock('$lib/helpers/publishAttributionClaim.js', () => io);
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

const AttributionClaims = (await import('../shared/AttributionClaims.svelte')).default;

const NAME_ONLY = [
  ['creator:type', 'Person'],
  ['creator:name', 'Paula Gregorio']
];
/** @param {string[][]} tags */
const resource = (tags = NAME_ONLY) => ({
  id: 'e'.repeat(64),
  kind: 30142,
  pubkey: PUBLISHER,
  created_at: 100,
  content: '',
  tags: [['d', 'res'], ...tags]
});
let n = 0;
const claim = (pubkey, name = 'Paula Gregorio', role = 'creator') => ({
  id: `claim-${++n}`,
  kind: 1985,
  pubkey,
  created_at: 200 - n,
  content: '',
  tags: [
    ['L', 'org.edufeed.attribution'],
    ['l', role, 'org.edufeed.attribution'],
    ['a', `30142:${PUBLISHER}:res`, ''],
    ['p', PUBLISHER, ''],
    ['name', name]
  ]
});
const user = (pubkey) => ({ pubkey, signer: {} });
/** A promise the test settles by hand, to observe the loading state. */
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

/** @param {{ event?: any, claims?: any[] }} [opts] */
function mount({ event = resource(), claims = [] } = {}) {
  state.claims$ = new BehaviorSubject(claims);
  return render(AttributionClaims, { props: { event } });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = null;
  state.latest = undefined;
  fetchEvents.mockReturnValue(of());
  eventStore.model.mockImplementation(() => state.claims$);
  eventStore.replaceable.mockImplementation(() => of(state.latest));
});

describe('AttributionClaims', () => {
  it('renders and loads nothing for an anonymous visitor', () => {
    const { container } = mount({ claims: [claim(PAULA)] });
    expect(container.textContent?.trim()).toBe('');
    expect(fetchEvents).not.toHaveBeenCalled();
  });

  it('renders nothing for the publisher without claims', () => {
    state.user = user(PUBLISHER);
    const { container } = mount();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders and loads nothing when every credit is linked already', () => {
    state.user = user(OTHER);
    const { container } = mount({ event: resource([['p', PAULA, '', 'creator']]) });
    expect(container.textContent?.trim()).toBe('');
    expect(fetchEvents).not.toHaveBeenCalled();
  });

  it('loads the claims on this content from the claim relays', () => {
    state.user = user(OTHER);
    mount();
    const filter = {
      kinds: [1985],
      '#a': [`30142:${PUBLISHER}:res`],
      '#L': ['org.edufeed.attribution']
    };
    expect(fetchEvents).toHaveBeenCalledWith(['wss://amb.example/'], filter);
    expect(eventStore.model.mock.calls[0][1]).toEqual(filter);
    expect(eventStore.replaceable).toHaveBeenCalledWith(30142, PUBLISHER, 'res');
  });

  it('offers "Das bin ich" on a name-only credit and sends the claim', async () => {
    state.user = user(OTHER);
    const event = resource();
    const sending = deferred();
    io.publishClaim.mockReturnValue(sending.promise);
    const { getByRole, queryByRole } = mount({ event });

    await fireEvent.click(getByRole('button', { name: 'Das bin ich' }));
    const dialog = getByRole('dialog');
    expect(dialog.textContent).toContain('Paula Gregorio');
    expect(dialog.textContent).toContain('Die veröffentlichende Person muss bestätigen.');
    expect(dialog.querySelector('input[type="radio"]')).toBeNull();

    const sendButton = getByRole('button', { name: 'Anfrage senden' });
    await fireEvent.click(sendButton);
    expect(io.publishClaim).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ role: 'creator', name: 'Paula Gregorio' }),
      state.user
    );
    // loading: both actions locked, spinner on the primary one
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.querySelector('.loading')).not.toBeNull();
    expect(getByRole('button', { name: 'Abbrechen' }).disabled).toBe(true);

    sending.resolve({});
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(showToast).toHaveBeenCalledWith('Anfrage gesendet', 'success');
  });

  it('lets the user pick one of several name-only credits', async () => {
    state.user = user(OTHER);
    io.publishClaim.mockResolvedValue({});
    const { getByRole, getAllByRole } = mount({
      event: resource([
        ...NAME_ONLY,
        ['contributor:name', 'Paula Gregorio'],
        ['creator:name', 'Paula Gregorio'] // repeated credit: one row, no duplicate key
      ])
    });
    await fireEvent.click(getByRole('button', { name: 'Das bin ich' }));
    const radios = getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    await fireEvent.click(radios[1]);
    await fireEvent.click(getByRole('button', { name: 'Anfrage senden' }));
    expect(io.publishClaim.mock.calls[0][1]).toMatchObject({
      role: 'contributor',
      name: 'Paula Gregorio'
    });
  });

  it('keeps the modal open with an inline error when sending fails', async () => {
    state.user = user(OTHER);
    io.publishClaim.mockRejectedValue(new Error('relay down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getByRole } = mount();
    await fireEvent.click(getByRole('button', { name: 'Das bin ich' }));
    await fireEvent.click(getByRole('button', { name: 'Anfrage senden' }));
    await waitFor(() =>
      expect(getByRole('alert').textContent).toContain('Das hat nicht geklappt.')
    );
    expect(getByRole('dialog')).toBeTruthy();
    expect(getByRole('button', { name: 'Anfrage senden' }).disabled).toBe(false);
    expect(showToast).not.toHaveBeenCalled();

    await fireEvent.click(getByRole('button', { name: 'Abbrechen' }));
    expect(() => getByRole('dialog')).toThrow();
  });

  it('shows the own open claim with "Zurückziehen" instead of the button', async () => {
    state.user = user(PAULA);
    const event = resource();
    const own = claim(PAULA);
    io.withdrawClaim.mockResolvedValue(undefined);
    const { getByTestId, getByRole, queryByRole } = mount({ event, claims: [own, claim(OTHER)] });

    expect(getByTestId('attribution-claim-own').textContent).toContain(
      'Anfrage gesendet – wartet auf Bestätigung (Paula Gregorio)'
    );
    expect(queryByRole('button', { name: 'Das bin ich' })).toBeNull();
    expect(queryByRole('button', { name: 'Bestätigen' })).toBeNull();

    await fireEvent.click(getByRole('button', { name: 'Zurückziehen' }));
    expect(io.withdrawClaim).toHaveBeenCalledWith(own, state.user, event);
  });

  it('offers the button again once the own claim is gone', async () => {
    state.user = user(PAULA);
    const { getByRole, queryByTestId } = mount({ claims: [claim(PAULA)] });
    state.claims$.next([]);
    await waitFor(() => expect(queryByTestId('attribution-claim-own')).toBeNull());
    expect(getByRole('button', { name: 'Das bin ich' })).toBeTruthy();
  });

  it('shows the publisher only the open claims, one row per claimant and credit', () => {
    state.user = user(PUBLISHER);
    const event = resource([
      ...NAME_ONLY,
      // OTHER was accepted as contributor already
      ['contributor:name', 'Otto Other'],
      ['contributor:id', 'nostr:npub1x'],
      ['p', OTHER, '', 'contributor']
    ]);
    const open = claim(PAULA);
    const { getByTestId, getAllByRole } = mount({
      event,
      claims: [
        open,
        claim(PAULA), // older duplicate
        claim(OTHER, 'Otto Other', 'contributor'), // accepted
        claim(OTHER, 'Nicht Mehr Genannt'), // outdated
        { ...claim(OTHER), tags: [] } // not a claim
      ]
    });

    const list = getByTestId('attribution-claims-incoming');
    expect(list.querySelectorAll('li')).toHaveLength(1);
    expect(list.textContent).toContain('Paula Profil');
    expect(list.textContent).toContain('möchte als «Paula Gregorio» verknüpft werden');
    expect(list.textContent).toContain('Urheber:in');
    expect(list.querySelector('a')?.getAttribute('href')).toBe(`/p/${PAULA}`);
    expect(getAllByRole('button', { name: 'Bestätigen' })).toHaveLength(1);
    // deletions of every claimant are asked for, so withdrawn claims disappear
    expect(useAuthorDeletions.mock.calls[0][0]()).toContain(PAULA);
  });

  it('confirms a claim with loading and inline error states', async () => {
    state.user = user(PUBLISHER);
    const event = resource();
    const open = claim(PAULA);
    const accepting = deferred();
    io.acceptClaim.mockReturnValue(accepting.promise);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getByRole } = mount({ event, claims: [open] });

    const button = getByRole('button', { name: 'Bestätigen' });
    await fireEvent.click(button);
    expect(io.acceptClaim).toHaveBeenCalledWith(event, open, state.user);
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.loading')).not.toBeNull();

    accepting.reject(new Error('signer said no'));
    await waitFor(() =>
      expect(getByRole('alert').textContent).toContain('Das hat nicht geklappt.')
    );
    expect(button.disabled).toBe(false);
  });

  it('drops a claim from the list once the store holds the accepted version', () => {
    state.user = user(PUBLISHER);
    state.latest = {
      ...resource([
        ['creator:name', 'Paula Gregorio'],
        ['creator:id', 'nostr:npub1x'],
        ['p', PAULA, '', 'creator']
      ]),
      created_at: 300
    };
    const { container } = mount({ claims: [claim(PAULA)] });
    expect(container.textContent?.trim()).toBe('');
  });
});
