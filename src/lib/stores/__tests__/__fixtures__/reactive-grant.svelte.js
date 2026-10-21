// Minimal reactive stand-in for nip05-ready-alert's getHandleGrant().
let grant = $state.raw({ state: 'none', address: '' });
export function getHandleGrant() {
  return grant;
}
/** @param {'none'|'pending'|'granted'} state */
export function setGrant(state) {
  grant = { state, address: state === 'none' ? '' : 'alice@edufeed.org' };
}
