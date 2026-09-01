<script>
  /**
   * iframe.diy protocol client. The frame's service worker proxies every
   * same-origin fetch here as JSON-RPC over postMessage; we answer from the
   * in-memory file map. webxdc.* RPC requests are delegated to `onRpc`.
   * Cross-origin subdomain isolation is the primary security boundary; the
   * sandbox attribute is defense-in-depth (no allow-top-navigation).
   */
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { buildFetchResponse } from './sandbox-protocol.js';

  let { id, files, bridgeScript, onRpc, onFrameReady = null, class_ = '' } = $props();

  /** @type {HTMLIFrameElement | undefined} */
  let iframeEl;

  const origin = $derived(`https://${id}.${runtimeConfig.webxdc?.sandboxDomain || 'iframe.diy'}`);

  /** @param {object} msg */
  function post(msg) {
    iframeEl?.contentWindow?.postMessage(msg, origin);
  }

  $effect(() => {
    // Read deps first so the effect re-registers when they change.
    const currentOrigin = origin;
    const currentFiles = files;
    const currentBridge = bridgeScript;
    if (!iframeEl) return;

    /** @param {MessageEvent} event */
    async function onMessage(event) {
      if (event.origin !== currentOrigin) return;
      if (event.source !== iframeEl?.contentWindow) return;
      const msg = event.data;
      if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;

      if (msg.method === 'ready' && msg.id === undefined) {
        onFrameReady?.(post);
        post({ jsonrpc: '2.0', method: 'init', params: { version: 1 } });
        return;
      }
      if (msg.id === undefined || !msg.method) return;

      if (msg.method === 'fetch') {
        const reqUrl = msg.params?.request?.url;
        try {
          const url = new URL(reqUrl);
          if (url.origin !== currentOrigin) {
            post({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32003, message: 'Origin mismatch' }
            });
            return;
          }
          const result = buildFetchResponse(url.pathname, currentFiles, {
            bridgeScript: currentBridge
          });
          post({ jsonrpc: '2.0', id: msg.id, result });
        } catch (err) {
          post({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: String(err) } });
        }
        return;
      }

      try {
        const result = await onRpc(msg.method, msg.params ?? {}, post);
        post({ jsonrpc: '2.0', id: msg.id, result: result ?? null });
      } catch (err) {
        post({ jsonrpc: '2.0', id: msg.id, error: { code: -1, message: String(err) } });
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

<iframe
  bind:this={iframeEl}
  src={`${origin}/`}
  title="Interactive app"
  class={`block ${class_}`}
  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
  allow="autoplay; fullscreen; gamepad; clipboard-write"
></iframe>
