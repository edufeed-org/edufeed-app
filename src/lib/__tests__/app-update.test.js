/**
 * shouldPromptUpdate — when the root layout shows the "new version, reload?"
 * toast: once per page lifetime, and deferred while a call is live.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { shouldPromptUpdate } from '$lib/helpers/app-update.js';

describe('shouldPromptUpdate', () => {
  it('prompts when an update is available, no call is live and nothing was shown yet', () => {
    expect(shouldPromptUpdate({ updateAvailable: true, inCall: false, prompted: false })).toBe(
      true
    );
  });

  it('stays quiet while the running code is current', () => {
    expect(shouldPromptUpdate({ updateAvailable: false, inCall: false, prompted: false })).toBe(
      false
    );
  });

  it('defers the prompt while a call is live', () => {
    expect(shouldPromptUpdate({ updateAvailable: true, inCall: true, prompted: false })).toBe(
      false
    );
  });

  it('prompts once the call phase returns to idle', () => {
    const base = { updateAvailable: true, prompted: false };
    expect(shouldPromptUpdate({ ...base, inCall: true })).toBe(false);
    expect(shouldPromptUpdate({ ...base, inCall: false })).toBe(true);
  });

  it('never prompts twice in one page lifetime', () => {
    expect(shouldPromptUpdate({ updateAvailable: true, inCall: false, prompted: true })).toBe(
      false
    );
  });

  it('treats a missing flag as false', () => {
    // @ts-expect-error — the store may hand over undefined before SSR hydration settles
    expect(shouldPromptUpdate({ updateAvailable: undefined, inCall: false, prompted: false })).toBe(
      false
    );
  });
});
