/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isPrivateIp } from '$lib/server/httpUrl.js';

/** @param {string} u */
const ip = (u) => isPrivateIp(new URL(u));

describe('isPrivateIp', () => {
  it('flags loopback / private / link-local hosts', () => {
    expect(ip('http://localhost/x.png')).toBe(true);
    expect(ip('http://127.0.0.1/x.png')).toBe(true);
    expect(ip('http://[::1]/x.png')).toBe(true);
    expect(ip('http://10.0.0.5/x.png')).toBe(true);
    expect(ip('http://192.168.1.10/x.png')).toBe(true);
    expect(ip('http://172.16.0.1/x.png')).toBe(true);
    expect(ip('http://172.31.255.254/x.png')).toBe(true);
    expect(ip('http://0.0.0.0/x.png')).toBe(true);
    expect(ip('http://printer.local/x.png')).toBe(true);
  });

  it('allows public hosts', () => {
    expect(ip('https://upload.wikimedia.org/x.png')).toBe(false);
    expect(ip('https://openverse.org/x.png')).toBe(false);
    expect(ip('http://172.15.0.1/x.png')).toBe(false);
    expect(ip('http://172.32.0.1/x.png')).toBe(false);
  });
});
