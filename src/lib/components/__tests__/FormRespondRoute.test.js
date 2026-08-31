/** @vitest-environment jsdom */
/**
 * /forms/[naddr]/respond — Plan 5 Task 1, item 4. Submit-time failures
 * (publish failure) must render ABOVE the still-mounted form, not replace
 * it: the top-level `{:else if error}` ladder branch is reserved for
 * PRE-submit load failures (bad naddr, no template found) where there is
 * genuinely no form to preserve. Overloading that same `error` state from a
 * submit-time failure would tear the whole page down and lose whatever the
 * applicant had typed. (The community-application fan-out branch was
 * removed with the Beitrittsformular layer, 2026-08-18.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const FORM_AUTHOR = 'a'.repeat(64);
const APPLICANT = 'b'.repeat(64);
const IDENTIFIER = 'membership';
const NADDR = 'naddr1test';

const formTemplateEvent = {
  kind: 30168,
  pubkey: FORM_AUTHOR,
  created_at: 1,
  id: 'form-id',
  sig: 'sig',
  content: '',
  tags: [['d', IDENTIFIER]]
};

/** Mutable knobs the individual tests flip before rendering. */
const holders = vi.hoisted(() => ({
  communityId: /** @type {string | null} */ (null),
  publishEventImpl: /** @type {(...args: any[]) => Promise<any>} */ (
    async () => ({ success: true })
  )
}));

// `readable(...)` snapshots its value at mock-eval time (module load, before
// any test has set holders.communityId) — a custom subscribe recomputes the
// URL from `holders` on every subscribe call instead, i.e. fresh for each
// render() in each test.
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {(v: any) => void} */ cb) => {
      cb({
        url: new URL(
          `http://localhost/forms/${NADDR}/respond${
            holders.communityId ? `?communityId=${holders.communityId}` : ''
          }`
        )
      });
      return () => {};
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: APPLICANT, signer: {} } }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: () => {},
    replaceable: () => ({
      subscribe: (/** @type {(e: any) => void} */ cb) => {
        cb(formTemplateEvent);
        return { unsubscribe: () => {} };
      }
    }),
    timeline: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
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
  getCommunikeyRelays: () => ['wss://communikey.example/']
}));

vi.mock('$lib/helpers/community', () => ({ joinCommunity: vi.fn(async () => undefined) }));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: async (/** @type {any} */ t) => t,
    sign: async (/** @type {any} */ t) => ({ ...t, id: 'signed-id', sig: 'sig' })
  })
}));

const publishEventMock = vi.fn((/** @type {any} */ ...args) => holders.publishEventImpl(...args));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any} */ ...args) => publishEventMock(...args)
}));

vi.mock('$lib/helpers/forms.js', () => ({
  buildResponseTags: (/** @type {any} */ values) =>
    Object.entries(values).map(([k, v]) => ['response', k, v]),
  decodeFormNaddr: () => ({ pubkey: FORM_AUTHOR, identifier: IDENTIFIER }),
  buildUserResponseFilter: () => ({ kinds: [1069] }),
  parseFormTemplate: () => ({ fields: [], isPublic: true }),
  nip44EncryptWith: async () => 'ciphertext',
  signerHasNip44: () => true
}));

vi.mock('$lib/paraglide/messages', () => ({
  forms_submit_login_required: () => 'Log in required',
  forms_submit_no_encryption: () => 'No encryption support',
  forms_already_responded: () => 'Already responded',
  forms_back_to_community: () => 'Back to community',
  forms_go_back: () => 'Go back',
  forms_submit_success: () => 'Response submitted successfully!',
  forms_submit_failed: () => 'Failed to submit response'
}));

// Stub FormRenderer (real .svelte fixture — see its header comment) so the
// test can type into an input and submit without pulling in
// FieldsRenderer/branching internals.
vi.mock('$lib/components/forms/FormRenderer.svelte', async () => {
  const mod = await import('./fixtures/FormRendererStub.svelte');
  return { default: mod.default };
});

const { default: FormRespondPage } = await import(
  '../../../routes/forms/[naddr=naddr]/respond/+page.svelte'
);

describe('/forms/[naddr]/respond — submit-time errors render above the form', () => {
  beforeEach(() => {
    holders.communityId = null;
    holders.publishEventImpl = async () => ({ success: true });
    publishEventMock.mockClear();
  });

  it('a publish failure surfaces above the form, not instead of it', async () => {
    holders.publishEventImpl = async () => {
      throw new Error('relay rejected');
    };

    render(FormRespondPage, { props: { data: { naddr: NADDR } } });

    const input = await screen.findByLabelText('full_name');
    await fireEvent.input(input, { target: { value: 'Petra' } });
    await fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => expect(screen.getByText('relay rejected')).toBeTruthy());
    expect(screen.getByTestId('form-renderer-stub')).toBeTruthy();
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText('full_name')).value).toBe(
      'Petra'
    );
  });

  // handleSubmit's very first check is `if (isSubmitting || ...) return;` —
  // FormRenderer stays mounted through an in-flight submit (see the
  // component's own comment), so its Submit button is still clickable while
  // the first submission is in flight. A second click before the first
  // await point resolves must be a no-op, not a second publish.
  it('a second submit while isSubmitting is true does not publish twice', async () => {
    let resolvePublish = /** @type {(v: any) => void} */ (() => {});
    holders.publishEventImpl = () =>
      new Promise((resolve) => {
        resolvePublish = resolve;
      });

    render(FormRespondPage, { props: { data: { naddr: NADDR } } });

    const input = await screen.findByLabelText('full_name');
    await fireEvent.input(input, { target: { value: 'Doubled' } });

    const submitButton = screen.getByText('Submit');
    // Both clicks land before the in-flight publish resolves — the second
    // call's synchronous isSubmitting guard must short-circuit it.
    await fireEvent.click(submitButton);
    await fireEvent.click(submitButton);

    expect(publishEventMock).toHaveBeenCalledTimes(1);

    resolvePublish({ success: true });
    await waitFor(() => expect(screen.getByText('Response submitted successfully!')).toBeTruthy());
    expect(publishEventMock).toHaveBeenCalledTimes(1);
  });
});
