/**
 * Request quota for /api/termi/chat: per pubkey per UTC day, plus a global
 * cap per UTC month (the SAIA budget).
 *
 * shortcut: in-memory per process, resets on restart; revisit with replicas
 * or if the month counter must survive deploys.
 *
 * @param {{ perUserDaily: number, globalMonthly: number, now?: () => number }} opts
 * @returns {{ take(pubkey: string): 'ok' | 'user' | 'global' }}
 */
export function createQuota({ perUserDaily, globalMonthly, now = Date.now }) {
  let day = '';
  let month = '';
  /** @type {Map<string, number>} */
  let perUser = new Map();
  let global = 0;

  return {
    take(pubkey) {
      const iso = new Date(now()).toISOString();
      if (iso.slice(0, 10) !== day) {
        day = iso.slice(0, 10);
        perUser = new Map();
      }
      if (iso.slice(0, 7) !== month) {
        month = iso.slice(0, 7);
        global = 0;
      }
      if (global >= globalMonthly) return 'global';
      const used = perUser.get(pubkey) ?? 0;
      if (used >= perUserDaily) return 'user';
      perUser.set(pubkey, used + 1);
      global++;
      return 'ok';
    }
  };
}
