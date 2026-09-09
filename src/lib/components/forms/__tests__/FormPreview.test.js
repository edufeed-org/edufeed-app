/** @vitest-environment jsdom */
/**
 * FormPreview (issue #77) — the preview must show the form the way a respondent
 * actually meets it.
 *
 * These assertions are chosen so the OLD preview would fail them. The published
 * form page used to render `<FormRenderer readonly />`, whose `readonly &&
 * hasSections` branch flattens every section onto one page with disabled inputs
 * and no navigation buttons. So "a Next button exists and advances the wizard",
 * "a later section's field is absent until reached" and "validation blocks Next"
 * are all impossible under it — which is what makes them meaningful here rather
 * than decorative. (`renders through the real builder encoder` below builds its
 * fixture with `builderStateToTags`, the same function publish() calls, so this
 * covers the builder → preview path end to end, not a hand-written tag list.)
 */
import { describe, it, expect, vi } from 'vitest';

// Stub matchMedia before any imports that pull in app-settings.svelte.js
// (FieldsRenderer → FormConceptPicker → relay-helper → app-settings).
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

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'en' }));

vi.mock('$lib/paraglide/messages', () => ({
  form_select_placeholder: () => '— Select —',
  form_min_characters: (/** @type {{ min: number }} */ { min }) => `Min ${min}`,
  form_encrypted_info: () => 'encrypted',
  form_submit: () => 'Submit',
  form_section_next: () => 'Next',
  form_section_back: () => 'Back',
  form_section_progress: (/** @type {{ current: number, total: number }} */ { current, total }) =>
    `Step ${current}/${total}`,
  forms_submit_success: () => 'Response submitted successfully!',
  form_preview_notice: () => 'PREVIEW NOTICE',
  form_preview_empty: () => 'PREVIEW EMPTY',
  form_preview_submitted_notice: () => 'NOTHING WAS PUBLISHED',
  form_preview_restart: () => 'Start over'
}));

// FormConceptPicker pulls in nostr/applesauce machinery — stub it (this
// fixture has no vocab-bound fields).
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({ default: () => null }));

const { render, fireEvent } = await import('@testing-library/svelte');
const { default: FormPreview } = await import('$lib/components/forms/FormPreview.svelte');
const { builderStateToTags, builderStateToPreviewEvent } = await import(
  '$lib/helpers/forms/builder-state.js'
);

/** Builder state for the 3-section routing/show-if form the e2e specs use. */
function builderFields() {
  const base = {
    defaultValue: '',
    required: false,
    placeholder: '',
    min: undefined,
    max: undefined,
    selectOptions: [],
    multiple: false
  };
  return [
    { ...base, id: 'sec-a', type: 'section', title: 'Section A' },
    {
      ...base,
      id: 'color',
      type: 'radio',
      label: 'Color',
      required: true,
      selectOptions: [
        { id: 'red', label: 'Red', nextSection: 'sec-c' },
        { id: 'blue', label: 'Blue' }
      ]
    },
    { ...base, id: 'sec-b', type: 'section', title: 'Section B' },
    { ...base, id: 'note', type: 'text', label: 'Note' },
    { ...base, id: 'sec-c', type: 'section', title: 'Section C' },
    {
      ...base,
      id: 'reason',
      type: 'text',
      label: 'Reason',
      displayIf: { rules: [{ questionId: 'color', operator: 'equals', value: 'red' }] }
    }
  ];
}

/** @param {any[]} [fields] */
const previewEvent = (fields = builderFields()) =>
  builderStateToPreviewEvent(fields, { dTag: 'preview-spec', name: 'Preview Spec' }, 'pk');

describe('FormPreview', () => {
  it('renders the wizard, not a flat readonly dump', async () => {
    const { getByText, queryByText, container } = render(FormPreview, {
      props: { formEvent: previewEvent() }
    });
    // Section wizard chrome — absent entirely under `readonly`.
    expect(getByText('Next')).toBeTruthy();
    expect(getByText('Step 1/3')).toBeTruthy();
    expect(getByText('Section A')).toBeTruthy();
    // Later sections are NOT on the page yet (readonly would show all three).
    expect(queryByText('Section B')).toBeNull();
    expect(container.querySelector('#note')).toBeNull();
    // Inputs are live, not disabled.
    const red = /** @type {HTMLInputElement} */ (container.querySelector('input[value="red"]'));
    expect(red).toBeTruthy();
    expect(red.disabled).toBe(false);
  });

  it('shows the preview notice', () => {
    const { getByText } = render(FormPreview, { props: { formEvent: previewEvent() } });
    expect(getByText('PREVIEW NOTICE')).toBeTruthy();
  });

  it('enforces required fields before advancing', async () => {
    const { getByText, container } = render(FormPreview, {
      props: { formEvent: previewEvent() }
    });
    await fireEvent.click(getByText('Next'));
    expect(getByText('Color is required')).toBeTruthy();
    // still on Section A
    expect(getByText('Step 1/3')).toBeTruthy();
    expect(container.querySelector('#note')).toBeNull();
  });

  it('falls through A->B linearly when the answer carries no route', async () => {
    const { getByText, container } = render(FormPreview, {
      props: { formEvent: previewEvent() }
    });
    await fireEvent.click(/** @type {Element} */ (container.querySelector('input[value="blue"]')));
    await fireEvent.click(getByText('Next'));
    expect(getByText('Section B')).toBeTruthy();
    expect(container.querySelector('#note')).toBeTruthy();
    // Reason belongs to Section C — not reached.
    expect(container.querySelector('#reason')).toBeNull();
  });

  it('routes A->C directly on the routed option, skipping B', async () => {
    const { getByText, queryByText, container } = render(FormPreview, {
      props: { formEvent: previewEvent() }
    });
    await fireEvent.click(/** @type {Element} */ (container.querySelector('input[value="red"]')));
    await fireEvent.click(getByText('Next'));
    // Linear order would have gone to B (as the previous test shows), so
    // landing on C is only explainable by the option route.
    expect(getByText('Section C')).toBeTruthy();
    expect(queryByText('Section B')).toBeNull();
    expect(container.querySelector('#note')).toBeNull();
    // show-if is true now, so Reason renders
    expect(container.querySelector('#reason')).toBeTruthy();
  });

  it('keeps a show-if field hidden on a reached section when its rule is false', async () => {
    const { getByText, container } = render(FormPreview, {
      props: { formEvent: previewEvent() }
    });
    await fireEvent.click(/** @type {Element} */ (container.querySelector('input[value="blue"]')));
    await fireEvent.click(getByText('Next')); // -> B
    await fireEvent.click(getByText('Next')); // -> C
    expect(getByText('Section C')).toBeTruthy();
    // Section C is reached, but Color is Blue so Reason must stay hidden.
    expect(container.querySelector('#reason')).toBeNull();
  });

  it('confirms on submit without publishing, and can restart', async () => {
    const fields = [
      {
        id: 'name',
        type: 'text',
        label: 'Name',
        defaultValue: '',
        required: false,
        placeholder: '',
        min: undefined,
        max: undefined,
        selectOptions: [],
        multiple: false
      }
    ];
    const event = builderStateToPreviewEvent(
      fields,
      { dTag: 'p', name: 'P', confirmationMessage: 'Danke!' },
      'pk'
    );
    const { getByText, queryByText } = render(FormPreview, { props: { formEvent: event } });

    await fireEvent.click(getByText('Submit'));
    // the author's own confirmation message is previewed too
    expect(getByText('Danke!')).toBeTruthy();
    expect(getByText('NOTHING WAS PUBLISHED')).toBeTruthy();
    expect(queryByText('Submit')).toBeNull();

    await fireEvent.click(getByText('Start over'));
    expect(getByText('Submit')).toBeTruthy();
    expect(queryByText('Danke!')).toBeNull();
  });

  it('renders an empty-state instead of a bare form when there are no fields', () => {
    const { getByText } = render(FormPreview, { props: { formEvent: previewEvent([]) } });
    expect(getByText('PREVIEW EMPTY')).toBeTruthy();
  });

  it('renders through the real builder encoder (builder -> preview path)', () => {
    // Not a hand-written tag list: this is what publish() would emit.
    const tags = builderStateToTags(builderFields(), { dTag: 'preview-spec' });
    const { getByText } = render(FormPreview, {
      props: {
        formEvent: /** @type {any} */ ({
          kind: 30168,
          tags,
          content: '',
          pubkey: 'pk',
          created_at: 0,
          id: '',
          sig: ''
        })
      }
    });
    expect(getByText('Section A')).toBeTruthy();
    expect(getByText('Next')).toBeTruthy();
  });
});
