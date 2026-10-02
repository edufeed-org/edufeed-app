// @ts-nocheck
/**
 * /call/<pointer>#<code> — the guest link landing route. CallLanding reads
 * the pass code from the hash once, at init, so SPA navigation to another
 * link (or just a new hash) must remount it (final review 2 minor).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$app/state', () => import('./fixtures/app-state-mock.svelte.js'));
vi.mock(
  '$lib/components/groups/call/CallLanding.svelte',
  () => import('./fixtures/CallLandingStub.svelte')
);

const { page } = await import('./fixtures/app-state-mock.svelte.js');
const { mounts } = await import('./fixtures/CallLandingStub.svelte');
const { default: CallPage } = await import('../../../routes/call/[pointer]/+page.svelte');

const RELAY = 'groups.example';

beforeEach(() => {
  mounts.count = 0;
  page.url = new URL(`http://localhost/call/${RELAY}'aaa#code1`);
});

describe('/call/[pointer] route', () => {
  it('remounts the landing for a new hash (new pass code), same channel', () => {
    render(CallPage, { props: { data: { rawPointer: `${RELAY}'aaa` } } });
    expect(mounts.count).toBe(1);
    flushSync(() => (page.url = new URL(`http://localhost/call/${RELAY}'aaa#code2`)));
    expect(mounts.count).toBe(2);
  });

  it('remounts the landing for another channel', async () => {
    const { rerender } = render(CallPage, { props: { data: { rawPointer: `${RELAY}'aaa` } } });
    expect(screen.getByTestId('call-landing-stub').textContent).toBe('aaa');
    await rerender({ data: { rawPointer: `${RELAY}'bbb` } });
    expect(mounts.count).toBe(2);
    expect(screen.getByTestId('call-landing-stub').textContent).toBe('bbb');
  });

  it('does not remount when nothing about the link changed', async () => {
    const { rerender } = render(CallPage, { props: { data: { rawPointer: `${RELAY}'aaa` } } });
    await rerender({ data: { rawPointer: `${RELAY}'aaa` } });
    expect(mounts.count).toBe(1);
  });
});
