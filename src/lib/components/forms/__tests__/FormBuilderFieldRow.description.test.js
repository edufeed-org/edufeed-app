/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Stub matchMedia before any imports that pull in app-settings.svelte.js
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

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

// vitest copies a mock factory's OWN keys into the module namespace, so a
// Proxy fallback never fires — the mock must enumerate every m.* key the
// component calls. Regenerate with:
//   grep -o "m\.[a-zA-Z0-9_]*(" FormBuilderFieldRow.svelte | sort -u
vi.mock('$lib/paraglide/messages', () => {
  const keys = [
    'form_builder_add_option',
    'form_builder_field_allow_multiple',
    'form_builder_field_name_placeholder',
    'form_builder_field_description_text',
    'form_builder_field_option_new',
    'form_builder_field_options_label',
    'form_builder_field_output_amb_about',
    'form_builder_field_output_amb_audience',
    'form_builder_field_output_amb_conditionsOfAccess',
    'form_builder_field_output_amb_creator',
    'form_builder_field_output_amb_dateCreated',
    'form_builder_field_output_amb_datePublished',
    'form_builder_field_output_amb_description',
    'form_builder_field_output_amb_educationalLevel',
    'form_builder_field_output_amb_hasPart',
    'form_builder_field_output_amb_id',
    'form_builder_field_output_amb_image',
    'form_builder_field_output_amb_inLanguage',
    'form_builder_field_output_amb_interactivityType',
    'form_builder_field_output_amb_isAccessibleForFree',
    'form_builder_field_output_amb_isPartOf',
    'form_builder_field_output_amb_keywords',
    'form_builder_field_output_amb_learningResourceType',
    'form_builder_field_output_amb_license',
    'form_builder_field_output_amb_name',
    'form_builder_field_output_amb_refs',
    'form_builder_field_output_auto',
    'form_builder_field_output_ext',
    'form_builder_field_output_label',
    'form_builder_field_output_relation_unset',
    'form_builder_field_placeholder_text',
    'form_builder_field_required',
    'form_builder_field_source_manual',
    'form_builder_field_source_prompt',
    'form_builder_field_source_switch_to_manual',
    'form_builder_field_source_switch_to_vocab',
    'form_builder_field_source_vocab',
    'form_builder_field_vocab_clear',
    'form_builder_field_vocab_concepts_count',
    'form_builder_field_vocab_invalid',
    'form_builder_field_vocab_label',
    'form_builder_field_vocab_loading',
    'form_builder_field_vocab_picker_label',
    'form_builder_field_vocab_picker_placeholder',
    'form_builder_field_vocab_placeholder',
    'form_builder_field_vocab_samples_label',
    'form_builder_max_length',
    'form_builder_max_value',
    'form_builder_min_length',
    'form_builder_min_value',
    'form_builder_option_route_label',
    'form_builder_option_route_none'
  ];
  return Object.fromEntries(keys.map((k) => [k, () => `m.${k}`]));
});

// Vocab machinery dials relays — stub it out.
vi.mock('$lib/stores/vocab-store.svelte.js', () => ({
  useSchemeConcepts: () => () => [],
  useConceptSchemes: () => () => []
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => []
}));
vi.mock('$lib/components/educational/SKOSDropdown.svelte', () => ({
  default: () => null
}));
vi.mock('$lib/components/forms/FormBuilderConditionRow.svelte', () => ({
  default: () => null
}));

const { render, fireEvent, cleanup } = await import('@testing-library/svelte');
const { default: FormBuilderFieldRow } = await import(
  '$lib/components/forms/FormBuilderFieldRow.svelte'
);

afterEach(() => cleanup());

/** A plain text field, as addField() creates it. */
function makeField() {
  return {
    id: 'q1',
    type: 'text',
    label: 'hello',
    defaultValue: '',
    required: false,
    placeholder: '',
    description: '',
    min: undefined,
    max: undefined,
    selectOptions: [],
    multiple: false,
    vocab: undefined
  };
}

/** @param {ReturnType<typeof makeField>} field */
function renderRow(field) {
  return render(FormBuilderFieldRow, {
    field,
    fields: [field],
    fieldIndex: 0,
    existing: false,
    sections: [],
    earlierQuestions: []
  });
}

describe('FormBuilderFieldRow description input', () => {
  it('typing into the description textarea lands in field.description', async () => {
    const field = makeField();
    const { getByPlaceholderText } = renderRow(field);
    const ta = getByPlaceholderText('m.form_builder_field_description_text');

    await fireEvent.input(ta, { target: { value: 'Bitte kurz begründen.' } });

    expect(field.description).toBe('Bitte kurz begründen.');
  });

  it('the textarea is offered for a choice type too, not only text fields', () => {
    const field = { ...makeField(), id: 'q2', type: 'checkbox' };
    const { getByPlaceholderText } = renderRow(field);
    expect(getByPlaceholderText('m.form_builder_field_description_text')).toBeTruthy();
  });
});
