// @ts-nocheck
/**
 * EventAttributesFields — registration / cost / format / educational level
 * fields of the calendar event form (issue #13).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({ levelField: null }));

vi.mock('$lib/helpers/educational/vocabResolver.js', () => ({
  resolveVocabField: (key) => (key === 'educationalLevel' ? h.levelField : null)
}));
vi.mock(
  '$lib/components/forms/FormConceptPicker.svelte',
  () => import('./fixtures/FormConceptPickerStub.svelte')
);

import Host from './fixtures/EventAttributesFieldsHost.svelte';

const LEVEL_FIELD = {
  type: 'concept-picker',
  id: 'educationalLevel',
  label: 'educationalLevel',
  vocab: { address: '39737:pub:educational-level', relay: 'wss://r.example' }
};

/** @param {HTMLElement} container */
const read = (container) =>
  JSON.parse(container.querySelector('[data-testid="attributes-json"]').textContent);

/** @param {HTMLElement} container @param {string} id @param {string} value */
async function choose(container, id, value) {
  const select = container.querySelector(`#${id}`);
  select.value = value;
  await fireEvent.change(select);
  await tick();
}

beforeEach(() => {
  cleanup();
  h.levelField = LEVEL_FIELD;
});

describe('EventAttributesFields', () => {
  it('defaults every field to "no statement"', () => {
    const { container } = render(Host);
    expect(container.querySelector('#event-attr-registration').value).toBe('');
    expect(container.querySelector('#event-attr-price').value).toBe('');
    expect(container.querySelector('#event-attr-mode').value).toBe('');
    expect(container.querySelector('#event-attr-amount')).toBeNull();
    expect(read(container)).toEqual({ educationalLevels: [] });
  });

  it('sets and clears registrationRequired', async () => {
    const { container } = render(Host);
    await choose(container, 'event-attr-registration', 'true');
    expect(read(container).registrationRequired).toBe(true);
    await choose(container, 'event-attr-registration', 'false');
    expect(read(container).registrationRequired).toBe(false);
    await choose(container, 'event-attr-registration', '');
    expect(read(container).registrationRequired).toBeUndefined();
  });

  it('"kostenlos" writes price 0 EUR', async () => {
    const { container } = render(Host);
    await choose(container, 'event-attr-price', 'free');
    expect(read(container).price).toEqual({ amount: '0', currency: 'EUR' });
    expect(container.querySelector('#event-attr-amount')).toBeNull();
  });

  it('"kostenpflichtig" asks for amount and currency (default EUR)', async () => {
    const { container } = render(Host);
    await choose(container, 'event-attr-price', 'paid');
    const amount = container.querySelector('#event-attr-amount');
    const currency = container.querySelector('#event-attr-currency');
    expect(currency.value).toBe('EUR');
    await fireEvent.input(amount, { target: { value: '25' } });
    await tick();
    expect(read(container).price).toEqual({ amount: '25', currency: 'EUR' });
    await fireEvent.input(currency, { target: { value: 'chf' } });
    await tick();
    expect(read(container).price).toEqual({ amount: '25', currency: 'CHF' });
    // Clearing the cost statement removes the price entirely.
    await choose(container, 'event-attr-price', '');
    expect(read(container).price).toBeUndefined();
  });

  it('keeps "kostenpflichtig" selected while the amount is still empty', async () => {
    const { container } = render(Host);
    await choose(container, 'event-attr-price', 'paid');
    expect(container.querySelector('#event-attr-price').value).toBe('paid');
    expect(container.querySelector('#event-attr-amount')).not.toBeNull();
  });

  it('sets the attendance mode', async () => {
    const { container } = render(Host);
    await choose(container, 'event-attr-mode', 'online');
    expect(read(container).attendanceMode).toBe('online');
    await choose(container, 'event-attr-mode', 'mixed');
    expect(read(container).attendanceMode).toBe('mixed');
  });

  it('pre-fills from existing attributes (edit mode)', () => {
    const { container } = render(Host, {
      props: {
        initial: {
          registrationRequired: true,
          price: { amount: '25', currency: 'EUR' },
          attendanceMode: 'offline',
          educationalLevels: [
            { id: 'https://w3id.org/kim/educationalLevel/level_B', labels: { de: 'Vorb.' } }
          ]
        }
      }
    });
    expect(container.querySelector('#event-attr-registration').value).toBe('true');
    expect(container.querySelector('#event-attr-price').value).toBe('paid');
    expect(container.querySelector('#event-attr-amount').value).toBe('25');
    expect(container.querySelector('#event-attr-mode').value).toBe('offline');
    expect(container.querySelector('[data-testid="concept-picker-value"]').textContent).toBe(
      JSON.stringify(['https://w3id.org/kim/educationalLevel/level_B'])
    );
  });

  it('stores picked educational levels with all their labels', async () => {
    const { container } = render(Host);
    await fireEvent.click(container.querySelector('[data-testid="concept-picker-pick"]'));
    await tick();
    expect(read(container).educationalLevels).toEqual([
      {
        id: 'https://w3id.org/kim/educationalLevel/level_C',
        labels: { de: 'Fortbildung', en: 'Advanced training' }
      }
    ]);
  });

  it('hides the educational level picker when no vocabulary is configured', () => {
    h.levelField = null;
    const { container } = render(Host);
    expect(container.querySelector('[data-testid="concept-picker-pick"]')).toBeNull();
  });
});
