// Vitest global setup.
//
// Neutralize WebSocket under jsdom so component tests never open real relay
// sockets. jsdom's WebSocket delegates to the `ws` package, whose browser build
// throws "ws does not work in the browser. Browser clients must use the native
// WebSocket object". Singleton stores (profile auto-load, relay warming on
// active account) auto-connect during a render, so that throw surfaces as a
// flaky, order-dependent unhandled rejection attributed to whichever component
// test happened to be running.
//
// Node-environment tests (typeof window === 'undefined') keep the real
// WebSocket — e.g. nostr-fetch.test.js injects its own MockWebSocket explicitly.
if (typeof window !== 'undefined') {
  class NoopWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = NoopWebSocket.CONNECTING;
    }

    send() {}
    close() {
      this.readyState = NoopWebSocket.CLOSED;
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  }

  // @ts-ignore - replace jsdom's ws-backed WebSocket with an inert stub
  globalThis.WebSocket = NoopWebSocket;
}

// jsdom's Blob/File implementation does not implement the body-reading
// methods (`text()`, `arrayBuffer()`, `stream()`) — jsdom considers them out
// of scope and leaves them unimplemented (see jsdom/jsdom#2555). Component
// tests that assert on `File#text()` (e.g. verifying a downloaded/cleaned
// file's contents) would otherwise fail with "file.text is not a function"
// purely due to this environment gap. Polyfill via FileReader, which jsdom
// does implement.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
