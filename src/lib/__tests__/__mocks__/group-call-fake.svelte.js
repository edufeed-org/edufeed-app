// A reactive stand-in for groups/group-call.svelte.js: the breakout store
// reads the call's phase/title through getGroupCallState() and moves the
// call with switchGroupCall(); tests drive both from here.
import { vi } from 'vitest';

let phase = $state(/** @type {string} */ ('idle'));
let title = $state('');
/** @type {{id: string, relay: string} | null} */
let pointer = $state.raw(null);
/** @type {{pubkey: string, signer: any} | null} */
let user = null;

export const switchGroupCall = vi.fn(
  async (/** @type {{id: string, relay: string}} */ next, /** @type {{title?: string}} */ view) => {
    phase = 'idle';
    await Promise.resolve();
    pointer = { ...next };
    title = view?.title ?? '';
    phase = 'ready';
  }
);

export function getGroupCallState() {
  return {
    get phase() {
      return phase;
    },
    get title() {
      return title;
    }
  };
}
export const getActiveCallPointer = () => (pointer ? { ...pointer } : null);
export const getActiveCallUser = () => user;

/** @param {{pointer: {id: string, relay: string} | null, user?: any, title?: string, phase?: string}} next */
export function setCall(next) {
  pointer = next.pointer;
  user = next.user ?? user;
  title = next.title ?? title;
  phase = next.phase ?? (next.pointer ? 'ready' : 'idle');
}
