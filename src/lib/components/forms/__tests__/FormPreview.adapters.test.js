/** @vitest-environment jsdom */
/**
 * Guards the behavioural consequence of swapping the published-form page's
 * Preview tab off `readonly` (issue #77).
 *
 * `readonly` was suppressing two interactive adapters:
 *   - RelationFieldAdapter:41 — `{#if !readonly}<AMBResourceSearchInput …>`
 *   - CreatorFieldAdapter:17  — a static <ul> instead of <CreatorInput>
 *
 * So an `amb-relation` field on that tab now mounts a live NIP-50 search input
 * where previously nothing rendered. Reading `AMBResourceSearchInput` says it
 * only queries from `onInput` behind a 300ms debounce, with an early return
 * under two characters — but a source read is not evidence that mounting is
 * quiet, and no other test mounts this tab with a relation field at all.
 * This pins it: mounting the preview must issue no search.
 *
 * The spy is on `ambSearchLoader` itself, which is the single call site
 * (`AMBResourceSearchInput.svelte:105`) — so this fails if anyone later adds
 * an on-mount or on-focus fetch, which is exactly the regression worth
 * catching.
 */
import { describe, it, expect, vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

const ambSearchSpy = vi.hoisted(() => vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) })));

vi.mock('$lib/loaders/amb-search.js', () => ({ ambSearchLoader: ambSearchSpy }));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'author-pub', signer: {} } }
}));

vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({ default: () => null }));

// Paraglide's real message module is used as-is: this test mounts CreatorInput
// and AMBResourceSearchInput, which between them read a long tail of keys, and
// enumerating them in a mock would make the test brittle against unrelated copy
// changes. The assertions below read field labels from the fixture, not copy.

const { render, fireEvent } = await import('@testing-library/svelte');
const { default: FormPreview } = await import('$lib/components/forms/FormPreview.svelte');
const { builderStateToPreviewEvent } = await import('$lib/helpers/forms/builder-state.js');

const base = {
  defaultValue: '',
  required: false,
  placeholder: '',
  min: undefined,
  max: undefined,
  selectOptions: [],
  multiple: false
};

/** A single-section form carrying both adapters `readonly` used to suppress. */
const previewEvent = () =>
  builderStateToPreviewEvent(
    [
      { ...base, id: 'rel', type: 'amb-relation', label: 'Related', output: 'amb:hasPart' },
      { ...base, id: 'who', type: 'creator', label: 'Creator', output: 'amb:creator' }
    ],
    { dTag: 'adapters', name: 'Adapters' },
    'author-pub'
  );

describe('FormPreview with interactive adapters (published-page tab swap)', () => {
  it('mounts an amb-relation field without issuing any AMB search', () => {
    ambSearchSpy.mockClear();
    const { getByText } = render(FormPreview, { props: { formEvent: previewEvent() } });

    // the preview really did render (guards against a vacuous pass where
    // nothing mounted at all and the spy was trivially uncalled)
    expect(getByText('Related')).toBeTruthy();

    expect(ambSearchSpy).not.toHaveBeenCalled();
  });

  it('mounts the interactive relation picker, not the readonly view', () => {
    const { container } = render(FormPreview, { props: { formEvent: previewEvent() } });
    // RelationFieldAdapter renders AMBResourceSearchInput only when !readonly.
    // Its text input is the observable difference from the old flat preview.
    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('mounts a creator field without throwing', () => {
    const { getByText } = render(FormPreview, { props: { formEvent: previewEvent() } });
    expect(getByText('Creator')).toBeTruthy();
  });

  // In-test positive control. Without this, "the spy was not called" is
  // satisfied just as well by a spy wired to nothing — the mount assertion
  // above would pass vacuously and read as proof. Typing into the picker must
  // reach the very spy the mount assertion relies on.
  it('DOES search once the user types — the detector works', async () => {
    vi.useFakeTimers();
    try {
      ambSearchSpy.mockClear();
      const { container } = render(FormPreview, { props: { formEvent: previewEvent() } });
      const search = /** @type {HTMLInputElement} */ (
        container.querySelector('.relative > input[type="text"]')
      );
      expect(search, 'expected AMBResourceSearchInput to have mounted').toBeTruthy();

      await fireEvent.input(search, { target: { value: 'wasser' } });
      expect(ambSearchSpy, 'must not fire before the 300ms debounce').not.toHaveBeenCalled();

      vi.advanceTimersByTime(350);
      expect(ambSearchSpy).toHaveBeenCalledTimes(1);
      // the spy's declared arg tuple is empty, so index it through `any`
      expect(/** @type {any[]} */ (ambSearchSpy.mock.calls[0])[0]).toEqual({
        searchText: 'wasser'
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
