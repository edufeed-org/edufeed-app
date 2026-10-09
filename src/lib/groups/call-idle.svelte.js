/**
 * Call chrome autohide ("Bühne", design 2b): the title pill and the dock
 * step back after a few seconds without input and come back on any pointer
 * move, touch, key or focus inside the stage — a video player's rule. The
 * stage names what holds the chrome up (an open menu, a drawer, the pointer
 * resting on the dock, a connection that is not fine) through `setBlocked`.
 *
 * Timers run on the stage's own window: the pop-out is a second document.
 */

export const CALL_IDLE_DELAY_MS = 3000;

/**
 * @param {{delay?: number}} [options]
 */
export function createCallIdle({ delay = CALL_IDLE_DELAY_MS } = {}) {
  let idle = $state(false);
  let blocked = false;
  /** @type {Window | null} */
  let win = null;
  /** @type {number | null} */
  let timer = null;

  function clear() {
    if (timer !== null) win?.clearTimeout(timer);
    timer = null;
  }
  function arm() {
    clear();
    if (blocked || !win) return;
    timer = win.setTimeout(() => {
      timer = null;
      idle = true;
    }, delay);
  }
  /** Any input: show the chrome and start the clock again. */
  function wake() {
    idle = false;
    arm();
  }
  /** The mouse left the stage: nothing to point at, hide right away. */
  /** @param {PointerEvent} event */
  function rest(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (blocked) return;
    clear();
    idle = true;
  }
  /** @param {boolean} value */
  function setBlocked(value) {
    if (blocked === value) return;
    blocked = value;
    if (value) {
      clear();
      idle = false;
    } else {
      arm();
    }
  }
  const WAKE_EVENTS = /** @type {const} */ ([
    'pointermove',
    'pointerdown',
    'keydown',
    'touchstart',
    'focusin'
  ]);
  /**
   * Listen on the stage root; returns the detach.
   * @param {HTMLElement} node
   */
  function attach(node) {
    win = node.ownerDocument.defaultView;
    if (!win) return () => {};
    for (const name of WAKE_EVENTS) node.addEventListener(name, wake, { passive: true });
    node.addEventListener('pointerleave', rest);
    arm();
    return () => {
      for (const name of WAKE_EVENTS) node.removeEventListener(name, wake);
      node.removeEventListener('pointerleave', rest);
      clear();
      win = null;
    };
  }

  return {
    get idle() {
      return idle;
    },
    wake,
    setBlocked,
    attach
  };
}
