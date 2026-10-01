// The running call in its own always-on-top window, like Meet / Teams web:
// Document Picture-in-Picture (Chromium desktop only — elsewhere the button
// is simply not offered; the video-element PiP fallback shows one person).
//
// A second VIEW of the one call, never a second connection: the call store
// keeps owning the Room, this mounts the same GroupCallStage into the
// window's document and registers it as on screen, so the dock steps aside
// even on other routes. livekit-client's adaptive stream knows Document PiP
// and keeps video flowing while the opener tab is in the background.
//
// Closing the window — the user, "back to tab", or the call ending — unmounts
// the stage and hands the call back to the page (stage or dock).
import { mount, unmount } from 'svelte';
import { getGroupCallState, leaveGroupCall, registerCallStageView } from './group-call.svelte.js';

let open = $state(false);
/** @type {any} */
let pipWindow = null;
/** @type {Record<string, any> | null} */
let stage = null;
/** @type {(() => void) | null} */
let stopWatching = null;

/** @returns {{ open: boolean }} */
export function getCallPopoutState() {
  return {
    get open() {
      return open;
    }
  };
}

export function canPopOutCall() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/**
 * Open the pop-out. Call from the click itself: requestWindow needs the
 * user activation, so the window is requested before anything is awaited.
 * @param {{ title: string, identityToPubkey: (identity: string) => string | null }} view
 */
export async function popOutCall(view) {
  if (pipWindow || !canPopOutCall()) return;
  const pip = await /** @type {any} */ (window).documentPictureInPicture.requestWindow({
    width: 640,
    height: 400
  });
  pipWindow = pip;
  pip.addEventListener('pagehide', () => teardown(pip), { once: true });
  adoptPageLook(document, pip.document, view.title);

  const { default: GroupCallStage } = await import(
    '$lib/components/groups/call/GroupCallStage.svelte'
  );
  if (pipWindow !== pip) return; // closed while the stage module loaded
  stage = mount(GroupCallStage, {
    target: pip.document.body,
    props: {
      title: view.title,
      identityToPubkey: view.identityToPubkey,
      onLeave: leaveGroupCall,
      onPopIn: popInCall,
      // no href: the dock's "back to call" keeps pointing at the channel
      registerView: () => registerCallStageView()
    }
  });
  open = true;

  // The call ended (left here, in the tab, or dropped / removed by the
  // server — the channel then shows why): nothing to show.
  const call = getGroupCallState();
  stopWatching = $effect.root(() => {
    $effect(() => {
      if (call.phase === 'idle' || call.phase === 'ended') popInCall();
    });
  });
}

/** Close the pop-out; the call goes on in the tab. */
export function popInCall() {
  const pip = pipWindow;
  if (!pip) return;
  teardown(pip);
  pip.close();
}

/** @param {any} pip */
function teardown(pip) {
  if (pipWindow !== pip) return;
  pipWindow = null;
  stopWatching?.();
  stopWatching = null;
  if (stage) unmount(stage);
  stage = null;
  open = false;
}

/**
 * Give the pop-out document the app's stylesheets, theme and language. The
 * window starts as about:blank, so link hrefs are made absolute and a base
 * URL keeps relative urls inside copied styles (fonts) resolving.
 * @param {Document} from
 * @param {Document} to
 * @param {string} title
 */
function adoptPageLook(from, to, title) {
  const base = to.createElement('base');
  base.href = from.baseURI;
  to.head.append(base);
  for (const node of from.head.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = /** @type {HTMLElement} */ (to.importNode(node, true));
    if (node instanceof HTMLLinkElement) /** @type {HTMLLinkElement} */ (copy).href = node.href;
    to.head.append(copy);
  }
  for (const attr of ['data-theme', 'lang']) {
    const value = from.documentElement.getAttribute(attr);
    if (value) to.documentElement.setAttribute(attr, value);
  }
  to.title = title;
  to.body.className = 'flex h-screen flex-col overflow-hidden bg-base-100 text-base-content';
}
