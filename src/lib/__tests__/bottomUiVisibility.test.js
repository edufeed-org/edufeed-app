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

  it('stays visible on neutral routes/views', () => {
    expect(hasStaticOwnBottomUI({ pathname: '/settings', viewParam: null })).toBe(false);
    expect(hasStaticOwnBottomUI({ pathname: '/c/npub1abc', viewParam: 'calendar' })).toBe(false);
    expect(hasStaticOwnBottomUI({ pathname: '/c/messages', viewParam: null })).toBe(false);
  });
});
