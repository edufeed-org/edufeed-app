/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  isBlockedIp,
  isPrivateIp,
  resolvesToPrivateIp,
  isBlockedHost,
  fetchGuardedRedirects
} from '$lib/server/httpUrl.js';

/**
 * Every fixture goes through `new URL()` rather than being hand-typed, because
 * the parser rewrites the hostname before our code sees it — see the
 * "WHATWG normalisation" block below. A guard tested against the string a
 * human imagined can pass while the real request still gets through.
 *
 * @param {string} u
 */
const ip = (u) => isPrivateIp(new URL(u));

describe('WHATWG normalisation (what the guard actually receives)', () => {
  it('collapses exotic IPv4 encodings to dotted quads before the guard runs', () => {
    // These need no special handling in isPrivateIp — asserted here so that
    // stays true if the parser ever changes.
    expect(new URL('http://2130706433/').hostname).toBe('127.0.0.1'); // decimal
    expect(new URL('http://0x7f000001/').hostname).toBe('127.0.0.1'); // hex
    expect(new URL('http://017700000001/').hostname).toBe('127.0.0.1'); // octal
    expect(new URL('http://127.1/').hostname).toBe('127.0.0.1'); // short form
    expect(new URL('http://0/').hostname).toBe('0.0.0.0'); // bare zero
  });

  it('hex-compresses IPv4-mapped IPv6 and keeps the brackets', () => {
    // The trap: the address arrives as [::ffff:7f00:1], NOT [::ffff:127.0.0.1].
    // A check looking for '::ffff:' plus a dotted quad never fires.
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    expect(new URL('http://[::ffff:169.254.169.254]/').hostname).toBe('[::ffff:a9fe:a9fe]');
    expect(new URL('http://[64:ff9b::127.0.0.1]/').hostname).toBe('[64:ff9b::7f00:1]');
  });
});

describe('isPrivateIp — literal IPv4', () => {
  it('blocks loopback, private, CGNAT, link-local and reserved ranges', () => {
    expect(ip('http://127.0.0.1/x.png')).toBe(true);
    expect(ip('http://127.255.255.254/x.png')).toBe(true);
    expect(ip('http://10.0.0.5/x.png')).toBe(true);
    expect(ip('http://192.168.1.10/x.png')).toBe(true);
    expect(ip('http://172.16.0.1/x.png')).toBe(true);
    expect(ip('http://172.31.255.254/x.png')).toBe(true);
    expect(ip('http://0.0.0.0/x.png')).toBe(true);
    expect(ip('http://169.254.169.254/latest/meta-data/')).toBe(true); // cloud metadata
    expect(ip('http://169.254.0.1/x.png')).toBe(true);
    expect(ip('http://100.64.0.1/x.png')).toBe(true); // CGNAT
    expect(ip('http://100.127.255.255/x.png')).toBe(true);
    expect(ip('http://192.0.0.1/x.png')).toBe(true);
    expect(ip('http://198.18.0.1/x.png')).toBe(true);
    expect(ip('http://224.0.0.1/x.png')).toBe(true); // multicast
    expect(ip('http://255.255.255.255/x.png')).toBe(true); // broadcast
  });

  it('blocks the exotic encodings via the parser, end to end', () => {
    expect(ip('http://2130706433/x.png')).toBe(true);
    expect(ip('http://0x7f000001/x.png')).toBe(true);
    expect(ip('http://017700000001/x.png')).toBe(true);
    expect(ip('http://127.1/x.png')).toBe(true);
    expect(ip('http://0/x.png')).toBe(true);
  });

  it('leaves public addresses just outside each block reachable', () => {
    // Boundary controls: without these, a guard that blocks everything passes
    // every test above.
    expect(ip('http://8.8.8.8/x.png')).toBe(false);
    expect(ip('http://172.15.0.1/x.png')).toBe(false); // just below 172.16/12
    expect(ip('http://172.32.0.1/x.png')).toBe(false); // just above — the old
    expect(ip('http://172.255.0.1/x.png')).toBe(false); // `172.` prefix broke these
    expect(ip('http://100.63.255.255/x.png')).toBe(false); // just below CGNAT
    expect(ip('http://100.128.0.1/x.png')).toBe(false); // just above
    expect(ip('http://169.253.255.255/x.png')).toBe(false);
    expect(ip('http://11.0.0.1/x.png')).toBe(false);
    expect(ip('http://192.0.1.1/x.png')).toBe(false); // just above 192.0.0.0/24
    expect(ip('http://198.20.0.1/x.png')).toBe(false);
    expect(ip('http://223.255.255.255/x.png')).toBe(false); // just below multicast
  });
});

describe('isPrivateIp — literal IPv6', () => {
  it('blocks loopback and unspecified in both bare and bracketed form', () => {
    expect(ip('http://[::1]/x.png')).toBe(true);
    expect(ip('http://[::]/x.png')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
  });

  it('unwraps IPv4-mapped, IPv4-compatible and NAT64 addresses to the v4 blocks', () => {
    expect(ip('http://[::ffff:127.0.0.1]/x.png')).toBe(true);
    expect(ip('http://[::ffff:169.254.169.254]/x.png')).toBe(true);
    expect(ip('http://[::ffff:10.0.0.1]/x.png')).toBe(true);
    expect(ip('http://[::ffff:192.168.0.1]/x.png')).toBe(true);
    expect(ip('http://[64:ff9b::127.0.0.1]/x.png')).toBe(true);
    // Control: a mapped *public* address must still be reachable, otherwise
    // "unwrapping works" is indistinguishable from "all v6 is blocked".
    expect(ip('http://[::ffff:8.8.8.8]/x.png')).toBe(false);
  });

  it('blocks unique-local, link-local and multicast v6', () => {
    expect(ip('http://[fc00::1]/x.png')).toBe(true);
    expect(ip('http://[fd12:3456::1]/x.png')).toBe(true);
    expect(ip('http://[fe80::1]/x.png')).toBe(true);
    expect(ip('http://[febf:ffff::1]/x.png')).toBe(true);
    expect(ip('http://[ff02::1]/x.png')).toBe(true);
  });

  it('unwraps the RFC2765 IPv4-translated form, whose 0xffff sits two bytes earlier', () => {
    // ::ffff:0:a.b.c.d is ::ffff:0:0/96 — the 0xffff is at bytes 8-9, not 10-11,
    // so it is a near-miss of the mapped form and needs its own branch.
    expect(ip('http://[::ffff:0:127.0.0.1]/x.png')).toBe(true);
    expect(ip('http://[::ffff:0:169.254.169.254]/x.png')).toBe(true);
    expect(ip('http://[::ffff:0:10.0.0.1]/x.png')).toBe(true);
    // Control: the public payload must survive, or this is a blanket v6 block.
    expect(ip('http://[::ffff:0:8.8.8.8]/x.png')).toBe(false);
  });

  it('blocks v6 transition tunnels and deprecated site-local', () => {
    expect(ip('http://[2002:7f00:1::]/x.png')).toBe(true); // 6to4
    expect(ip('http://[2002::1]/x.png')).toBe(true);
    expect(ip('http://[2001:0:0:0:0:0:7f00:1]/x.png')).toBe(true); // Teredo
    expect(ip('http://[2001::1]/x.png')).toBe(true);
    expect(ip('http://[fec0::1]/x.png')).toBe(true); // site-local, RFC3879
    expect(ip('http://[feff:ffff::1]/x.png')).toBe(true);
  });

  it('leaves global unicast v6 reachable', () => {
    expect(ip('http://[2606:4700:4700::1111]/x.png')).toBe(false); // Cloudflare
    expect(ip('http://[2001:4860:4860::8888]/x.png')).toBe(false); // Google
    // Boundary controls for the two tunnel prefixes. 2001::/32 is Teredo, but
    // 2001:db8:: and 2001:4860:: are ordinary global unicast — a check written as
    // `bytes[0]==0x20 && bytes[1]==0x01` alone would swallow both.
    expect(ip('http://[2001:db8::1]/x.png')).toBe(false);
    expect(ip('http://[2003::1]/x.png')).toBe(false); // just above 2002::/16
    expect(ip('http://[2000::1]/x.png')).toBe(false); // just below
  });
});

describe('isPrivateIp — hostnames', () => {
  it('blocks names that are internal by convention', () => {
    expect(ip('http://localhost/x.png')).toBe(true);
    expect(ip('http://printer.local/x.png')).toBe(true);
    expect(ip('http://app.localhost/x.png')).toBe(true);
    expect(ip('http://db.internal/x.png')).toBe(true);
    expect(ip('http://nas.home.arpa/x.png')).toBe(true);
  });

  it('blocks the fully-qualified trailing-dot forms of those names', () => {
    // `URL.hostname` preserves the trailing dot, so an exact match on 'localhost'
    // and a `.local` suffix match both miss without normalisation. These resolve
    // to the same addresses as the dotless forms.
    expect(ip('http://localhost./x.png')).toBe(true);
    expect(ip('http://printer.local./x.png')).toBe(true);
    expect(ip('http://app.localhost./x.png')).toBe(true);
    expect(ip('http://db.internal./x.png')).toBe(true);
    expect(ip('http://nas.home.arpa./x.png')).toBe(true);
  });

  it('does not block public names that merely contain those words', () => {
    expect(ip('https://upload.wikimedia.org/x.png')).toBe(false);
    expect(ip('https://openverse.org/x.png')).toBe(false);
    expect(ip('https://localhost.example.com/x.png')).toBe(false);
    expect(ip('https://internal-affairs.example.org/x.png')).toBe(false);
    // Trailing-dot normalisation must not turn public FQDNs into blocked ones.
    expect(ip('https://upload.wikimedia.org./x.png')).toBe(false);
    expect(ip('https://localhost.example.com./x.png')).toBe(false);
  });
});

describe('resolvesToPrivateIp — the DNS-rebinding half', () => {
  /** @param {string[]} addresses */
  const lookupReturning = (addresses) => async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('blocks a public name that resolves to a private address', async () => {
    expect(await resolvesToPrivateIp('rebind.example.com', lookupReturning(['10.1.2.3']))).toBe(
      true
    );
    expect(
      await resolvesToPrivateIp('metadata.example.com', lookupReturning(['169.254.169.254']))
    ).toBe(true);
    expect(await resolvesToPrivateIp('v6.example.com', lookupReturning(['fd00::1']))).toBe(true);
  });

  it('blocks when only one of several answers is private', async () => {
    expect(
      await resolvesToPrivateIp(
        'mixed.example.com',
        lookupReturning(['93.184.216.34', '127.0.0.1'])
      )
    ).toBe(true);
  });

  it('allows a name that resolves entirely to public addresses', async () => {
    expect(
      await resolvesToPrivateIp(
        'public.example.com',
        lookupReturning(['93.184.216.34', '2606:4700::1111'])
      )
    ).toBe(false);
  });

  it('short-circuits literal IPs without resolving', async () => {
    const explode = async () => {
      throw new Error('lookup must not be called for a literal IP');
    };
    expect(await resolvesToPrivateIp('127.0.0.1', explode)).toBe(true);
    expect(await resolvesToPrivateIp('[::1]', explode)).toBe(true);
    expect(await resolvesToPrivateIp('8.8.8.8', explode)).toBe(false);
  });

  it('fails open on lookup failure, because an unresolvable name cannot be fetched either', async () => {
    const nxdomain = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    expect(await resolvesToPrivateIp('nope.invalid', nxdomain)).toBe(false);
  });
});

describe('isBlockedHost — the guard the routes call', () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];

  it('blocks on the synchronous check without needing DNS', async () => {
    const explode = async () => {
      throw new Error('lookup must not be called');
    };
    expect(await isBlockedHost(new URL('http://169.254.169.254/'), explode)).toBe(true);
    expect(await isBlockedHost(new URL('http://[::ffff:127.0.0.1]/'), explode)).toBe(true);
    expect(await isBlockedHost(new URL('http://localhost/'), explode)).toBe(true);
  });

  it('blocks on DNS when the literal check passes', async () => {
    expect(await isBlockedHost(new URL('https://rebind.example.com/'), privateLookup)).toBe(true);
  });

  it('allows a genuinely public host', async () => {
    expect(await isBlockedHost(new URL('https://upload.wikimedia.org/x.png'), publicLookup)).toBe(
      false
    );
  });
});

describe('fetchGuardedRedirects — every hop re-validated', () => {
  /**
   * A fetch stub that replays a scripted sequence of responses and records the
   * URLs it was asked for, so a test can assert the guard stopped *before* the
   * request rather than after it.
   *
   * @param {Response[]} responses
   */
  function scriptedFetch(responses) {
    /** @type {string[]} */
    const seen = [];
    let i = 0;
    const impl = async (/** @type {string} */ url) => {
      seen.push(String(url));
      const next = responses[i++];
      if (!next) throw new Error(`unscripted fetch for ${url}`);
      return next;
    };
    return { impl, seen };
  }

  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const original = globalThis.fetch;

  /** @param {Response[]} responses */
  const install = (responses) => {
    const s = scriptedFetch(responses);
    globalThis.fetch = /** @type {any} */ (s.impl);
    return s;
  };

  const restore = () => {
    globalThis.fetch = original;
  };

  it('rejects a redirect into loopback and never requests the internal URL', async () => {
    const s = install([
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:18108/health' } })
    ]);
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 5, publicLookup)
      ).rejects.toThrow(/disallowed target/i);
      // The positive-control half: the guard's value is that the second URL was
      // never fetched, not merely that we threw.
      expect(s.seen).toEqual(['https://public.example.com/a']);
    } finally {
      restore();
    }
  });

  it('rejects a redirect into IPv4-mapped loopback, which the old check let through', async () => {
    const s = install([
      new Response(null, {
        status: 301,
        headers: { location: 'http://[::ffff:127.0.0.1]:18108/health' }
      })
    ]);
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 5, publicLookup)
      ).rejects.toThrow(/disallowed target/i);
      expect(s.seen).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('rejects a redirect into the cloud metadata endpoint', async () => {
    install([
      new Response(null, {
        status: 307,
        headers: { location: 'http://169.254.169.254/latest/meta-data/iam/' }
      })
    ]);
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 5, publicLookup)
      ).rejects.toThrow(/disallowed target/i);
    } finally {
      restore();
    }
  });

  it('rejects a redirect to a public name that resolves private', async () => {
    install([
      new Response(null, { status: 302, headers: { location: 'https://rebind.example.com/x' } })
    ]);
    const privateLookup = async () => [{ address: '10.0.0.7', family: 4 }];
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 5, privateLookup)
      ).rejects.toThrow(/disallowed target/i);
    } finally {
      restore();
    }
  });

  it('still follows a public redirect chain to completion', async () => {
    // Control: the rejections above mean nothing if the guard simply rejects
    // every redirect.
    const s = install([
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/b' } }),
      new Response('ok', { status: 200 })
    ]);
    try {
      const res = await fetchGuardedRedirects('https://public.example.com/a', {}, 5, publicLookup);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
      expect(s.seen).toEqual(['https://public.example.com/a', 'https://cdn.example.com/b']);
    } finally {
      restore();
    }
  });

  it('rejects a non-http(s) redirect target', async () => {
    install([new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } })]);
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 5, publicLookup)
      ).rejects.toThrow(/disallowed target/i);
    } finally {
      restore();
    }
  });

  it('gives up after maxRedirects', async () => {
    install(
      Array.from(
        { length: 4 },
        () =>
          new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/b' } })
      )
    );
    try {
      await expect(
        fetchGuardedRedirects('https://public.example.com/a', {}, 2, publicLookup)
      ).rejects.toThrow(/too many redirects/i);
    } finally {
      restore();
    }
  });
});
