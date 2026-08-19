/**
 * The host side of window.webxdc: maps the webxdc API (spec: webxdc.org) onto
 * an AppSync backend, and generates the bridge script the sandbox serves at
 * /webxdc.js. Serial numbers are assigned by update order (index + 1).
 */

const SEND_UPDATE_MAX_SIZE = 65536;
const REALTIME_MAX_BYTES = 128000;

/**
 * @param {import('./local-sync.js').AppSync} sync
 * @param {{ selfAddr: string, selfName: string }} identity
 */
export function createWebxdcHost(sync, identity) {
  let listenerSerial = null; // null until the app registers a listener
  let realtimeOff = null;

  const serialized = () => {
    const updates = sync.getUpdates();
    return updates.map((u, i) => ({ ...u, serial: i + 1, max_serial: updates.length }));
  };

  function deliverNew(post) {
    if (listenerSerial === null) return;
    for (const update of serialized()) {
      if (update.serial > listenerSerial) {
        listenerSerial = update.serial;
        post({ jsonrpc: '2.0', method: 'webxdc.update', params: { update } });
      }
    }
  }

  return {
    bridgeScript: generateBridgeScript(identity),

    /** Wire live update delivery. Returns an unsubscribe. */
    start(post) {
      return sync.subscribe(() => deliverNew(post));
    },

    async handleRpc(method, params, post) {
      switch (method) {
        case 'webxdc.sendUpdate': {
          const { payload, info, document, summary } = params.update ?? {};
          if (JSON.stringify(payload ?? null).length > SEND_UPDATE_MAX_SIZE) {
            throw new Error(`Update exceeds sendUpdateMaxSize (${SEND_UPDATE_MAX_SIZE})`);
          }
          sync.sendState(payload, { info, document, summary });
          return null;
        }
        case 'webxdc.setUpdateListener': {
          listenerSerial = params?.serial ?? 0;
          deliverNew(post);
          return null;
        }
        case 'webxdc.getAllUpdates':
          return serialized();
        case 'webxdc.realtimeChannel.join': {
          realtimeOff?.();
          realtimeOff = sync.onRealtime((bytes) => {
            post({
              jsonrpc: '2.0',
              method: 'webxdc.realtimeChannel.data',
              params: { data: [...bytes] }
            });
          });
          return null;
        }
        case 'webxdc.realtimeChannel.send': {
          const data = params?.data ?? [];
          if (data.length > REALTIME_MAX_BYTES) {
            throw new Error(`Realtime payload exceeds ${REALTIME_MAX_BYTES} byte limit`);
          }
          sync.sendRealtime(Uint8Array.from(data));
          return null;
        }
        case 'webxdc.realtimeChannel.leave': {
          realtimeOff?.();
          realtimeOff = null;
          return null;
        }
        default:
          throw new Error(`Unknown RPC method: ${method}`);
      }
    }
  };
}

/** @param {{ selfAddr: string, selfName: string }} identity */
function generateBridgeScript({ selfAddr, selfName }) {
  return `(function () {
  var nextId = 1;
  var pending = {};
  var updateListener = null;
  var realtimeListener = null;

  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;
    if (data.id !== undefined && !data.method) {
      var p = pending[data.id];
      if (!p) return;
      delete pending[data.id];
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
      return;
    }
    if (data.method === 'webxdc.update' && updateListener) {
      updateListener(data.params.update);
    } else if (data.method === 'webxdc.realtimeChannel.data' && realtimeListener) {
      realtimeListener(new Uint8Array(data.params.data));
    }
  });

  window.webxdc = {
    selfAddr: ${JSON.stringify(selfAddr)},
    selfName: ${JSON.stringify(selfName)},
    sendUpdateInterval: 1000,
    sendUpdateMaxSize: ${SEND_UPDATE_MAX_SIZE},
    sendUpdate: function (update, descr) {
      request('webxdc.sendUpdate', { update: update, descr: descr });
    },
    setUpdateListener: function (cb, serial) {
      updateListener = cb;
      return request('webxdc.setUpdateListener', { serial: serial || 0 });
    },
    getAllUpdates: function () {
      return request('webxdc.getAllUpdates', {});
    },
    sendToChat: function () {
      return Promise.reject(new Error('sendToChat is not supported'));
    },
    importFiles: function () {
      return Promise.resolve([]);
    },
    joinRealtimeChannel: function () {
      request('webxdc.realtimeChannel.join', {});
      return {
        setListener: function (cb) { realtimeListener = cb; },
        send: function (data) {
          request('webxdc.realtimeChannel.send', { data: Array.prototype.slice.call(data) });
        },
        leave: function () {
          realtimeListener = null;
          request('webxdc.realtimeChannel.leave', {});
        }
      };
    }
  };
})();`;
}
