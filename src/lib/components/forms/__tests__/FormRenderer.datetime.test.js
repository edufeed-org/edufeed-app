/** @vitest-environment jsdom */
/**
 * NIP-101-EDU `datetime` field: a date input plus a time input; the time
 * part is switched off while the field named by `settings.allDayField` is
 * checked. Answers are `YYYY-MM-DD` or local `YYYY-MM-DDTHH:MM`.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/paraglide/messages', () => ({
  form_encrypted_info: () => 'encrypted',
  form_submit: () => 'Submit',
  form_datetime_time_label: () => 'Uhrzeit'
}));
vi.mock('$lib/components/forms/FormConceptPicker.svelte', () => ({ default: () => null }));
vi.mock(
  '$lib/components/shared/EuropeanDateInput.svelte',
  () => import('../../__tests__/fixtures/ValueInputStub.svelte')
);
vi.mock(
  '$lib/components/shared/EuropeanTimeInput.svelte',
  () => import('../../__tests__/fixtures/ValueInputStub.svelte')
);

const { render, fireEvent } = await import('@testing-library/svelte');
const { tick } = await import('svelte');
const { default: FormRenderer } = await import('$lib/components/forms/FormRenderer.svelte');

function makeFormEvent() {
  return {
    id: 'evt1',
    pubkey: '0'.repeat(64),
    kind: 30168,
    created_at: 0,
    sig: '',
    content: '',
    tags: [
      ['d', 'cal'],
      ['settings', JSON.stringify({ output: 'nip52-calendar' })],
      ['field', 'allday', 'text', 'Ganztägig', '[]', '{"renderElement":"checkbox"}'],
      [
        'field',
        'start',
        'text',
        'Beginn',
        '[]',
        '{"renderElement":"datetime","required":true,"allDayField":"allday"}'
      ],
      ['field', 'plain', 'text', 'Ohne Schalter', '[]', '{"renderElement":"datetime"}']
    ]
  };
}

/** @param {HTMLElement} container @param {string} selector @param {string} value */
async function setInput(container, selector, value) {
  const input = /** @type {HTMLInputElement} */ (container.querySelector(selector));
  input.value = value;
  await fireEvent.input(input);
  await tick();
}

function setup() {
  /** @type {Record<string, any> | null} */
  let captured = null;
  const r = render(FormRenderer, {
    props: { formEvent: makeFormEvent(), onsubmit: (v) => (captured = { ...v }) }
  });
  return { ...r, submitted: () => captured };
}

describe('FormRenderer datetime field', () => {
  it('renders a date and a time input and answers YYYY-MM-DDTHH:MM', async () => {
    const r = setup();
    expect(r.container.querySelector('#start')).toBeTruthy();
    expect(r.container.querySelector('#start-time')).toBeTruthy();
    await setInput(r.container, '#start', '2026-11-20');
    await setInput(r.container, '#start-time', '14:00');
    await fireEvent.click(r.getByText('Submit'));
    expect(r.submitted()?.start).toBe('2026-11-20T14:00');
  });

  it('answers the date alone while no time is given', async () => {
    const r = setup();
    await setInput(r.container, '#start', '2026-11-20');
    await fireEvent.click(r.getByText('Submit'));
    expect(r.submitted()?.start).toBe('2026-11-20');
  });

  it('hides the time while the all-day field is checked and restores it after', async () => {
    const r = setup();
    await setInput(r.container, '#start', '2026-11-20');
    await setInput(r.container, '#start-time', '14:00');

    const allDay = /** @type {HTMLInputElement} */ (
      r.container.querySelector('input[type="checkbox"]')
    );
    await fireEvent.click(allDay);
    await tick();
    expect(r.container.querySelector('#start-time')).toBeNull();
    // The field without allDayField keeps its time input.
    expect(r.container.querySelector('#plain-time')).toBeTruthy();
    await fireEvent.click(r.getByText('Submit'));
    expect(r.submitted()).toMatchObject({ allday: 'true', start: '2026-11-20' });

    await fireEvent.click(allDay);
    await tick();
    expect(r.container.querySelector('#start-time')).toBeTruthy();
    await fireEvent.click(r.getByText('Submit'));
    expect(r.submitted()).toMatchObject({ allday: 'false', start: '2026-11-20T14:00' });
  });

  it('pre-fills date and time from an existing answer', async () => {
    const r = render(FormRenderer, {
      props: { formEvent: makeFormEvent(), initialValues: { start: '2026-11-20T09:30' } }
    });
    await tick();
    expect(/** @type {HTMLInputElement} */ (r.container.querySelector('#start')).value).toBe(
      '2026-11-20'
    );
    expect(/** @type {HTMLInputElement} */ (r.container.querySelector('#start-time')).value).toBe(
      '09:30'
    );
  });
});
