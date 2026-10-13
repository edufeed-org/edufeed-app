// A reactive stand-in for groups/group-call.svelte.js: the breakout store
// reads the call's phase/title/code through getGroupCallState() and moves
// the call with switchGroupCall(); tests drive both from here.
import { vi } from 'vitest';

let phase = $state(/** @type {string} */ ('idle'));
let title = $state('');
/** @type {string | null} the call pass code the call was joined with (a guest seat) */
let code = $state(null);
/** @type {Error | null} */
let error = $state(null);
/** @type {{id: string, relay: string} | null} */
let pointer = $state.raw(null);
/** @type {{pubkey: string, signer: any} | null} */
let user = null;
/** @type {Error | null} the error the next switch ends in (failNextSwitch) */
let nextSwitchError = null;

export const switchGroupCall = vi.fn(
  async (
    /** @type {{id: string, relay: string}} */ next,
    /** @type {{title?: string, code?: string, token?: any}} */ view
  ) => {
    // The same guard as the real store: a live, ended or errored call
    // moves (an errored one: the way back after a failed room switch).
    if (!user || !['requesting', 'ready', 'ended', 'error'].includes(phase)) return;
    phase = 'idle';
    await Promise.resolve();
    pointer = { ...next };
    title = view?.title ?? '';
    code = view?.code ?? code;
    if (nextSwitchError) {
      // Like the real store: the channel switched to is the active one,
      // and the join into it failed.
      error = nextSwitchError;
      nextSwitchError = null;
      phase = 'error';
      return;
    }
    error = null;
    phase = 'ready';
  }
);

/** Make the next switch fail the way a refused token / lost network does. @param {Error | null} err */
export function failNextSwitch(err) {
  nextSwitchError = err;
}

export const callErrorMessage = vi.fn((/** @type {unknown} */ err) =>
  err instanceof Error ? err.message : String(err)
);

export function getGroupCallState() {
  return {
    get phase() {
      return phase;
    },
    get title() {
      return title;
    },
    get code() {
      return code;
    },
    get error() {
      return error;
    }
  };
}
export const getActiveCallPointer = () => (pointer ? { ...pointer } : null);
export const getActiveCallUser = () => user;

/** @param {{pointer: {id: string, relay: string} | null, user?: any, title?: string, phase?: string, code?: string | null, error?: Error | null}} next */
export function setCall(next) {
  nextSwitchError = null;
  pointer = next.pointer;
  user = next.user ?? user;
  title = next.title ?? title;
  phase = next.phase ?? (next.pointer ? 'ready' : 'idle');
  if ('code' in next) code = next.code ?? null;
  if ('error' in next) error = next.error ?? null;
}
