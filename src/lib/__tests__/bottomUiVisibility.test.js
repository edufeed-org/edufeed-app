/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { hasStaticOwnBottomUI } from '../helpers/bottomUiVisibility.js';

describe('hasStaticOwnBottomUI', () => {
  it('hides on /create/ wizard routes', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/create/resource/amb', viewParam: null })).toBe(true);
  });

  it('hides on the standalone Concord private-area route (/private/[id])', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/private/abc123', viewParam: null })).toBe(true);
  });

  it('hides on the community public chat tab (?view=chat)', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/c/npub1abc', viewParam: 'chat' })).toBe(true);
  });

  it('hides on the community Concord channels tab (?view=channels)', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/c/npub1abc', viewParam: 'channels' })).toBe(true);
  });

  // A guest on a call link saw Termi's bubble and the "+" FAB on top of the
  // call chat (live test 2026-10-01): the landing page is the call only.
  it('hides on the guest call landing page (/call/<pointer>)', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/call/groups.example%27g1', viewParam: null })).toBe(
      true
    );
  });

  it('stays visible on neutral routes/views', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/settings', viewParam: null })).toBe(false);
    expect(hasStaticOwnBottomUI({ pathname: '/c/npub1abc', viewParam: 'calendar' })).toBe(false);
    expect(hasStaticOwnBottomUI({ pathname: '/c/messages', viewParam: null })).toBe(false);
  });
});
