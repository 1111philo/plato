// SSRF defense for the link-attachment feature. The server fetches
// user-supplied URLs from inside AWS, so an unguarded fetch is a textbook
// server-side request forgery hole — a learner could point plato at
// `http://169.254.169.254/...` (the EC2/Lambda instance metadata endpoint) or
// at internal services.
//
// Two layers:
//   1. `assertSafeUrl` + `assertSafeHost` — cheap up-front checks (scheme/port,
//      and literal-IP / pre-resolution host validation), run before fetching
//      and on every redirect hop.
//   2. `safeLookup` — the authoritative guard. Wired into the fetch agent's
//      `connect.lookup` so the connection uses the *same* address we validate.
//      This closes the DNS-rebinding TOCTOU gap: a plain "resolve, validate,
//      then fetch" lets the hostname re-resolve to an internal IP between the
//      check and the connection; pinning the connection to the validated
//      address removes that window.

import dns from 'node:dns';
import net from 'node:net';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
// '' = default port (80/443). 8080 is a common public alt-HTTP port.
const ALLOWED_PORTS = new Set(['', '80', '443', '8080']);

/** A user-surfaceable failure. `status` is the HTTP code the route should return. */
export class LinkError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'LinkError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Validate the URL shape. Returns a parsed URL on success, throws LinkError.
 */
export function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new LinkError('invalid_url', "That doesn't look like a valid URL.");
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new LinkError('bad_scheme', 'Only http and https links are supported.');
  }
  if (u.username || u.password) {
    throw new LinkError('bad_url', 'URLs with embedded credentials are not allowed.');
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    throw new LinkError('bad_port', 'That URL uses a port that is not allowed.');
  }
  return u;
}

function ipv4Blocked(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — block defensively
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (RFC 2544)
  if (a >= 224) return true; // multicast (224+) + reserved (240+) + 255.255.255.255
  return false;
}

// Expand any valid IPv6 textual form into its 8 16-bit groups so range checks
// can't be dodged with an alternate representation (compressed `::`, expanded,
// hex-form IPv4-mapped `::ffff:7f00:1`, dotted `::ffff:127.0.0.1`, zone ids).
function expandIpv6(input) {
  let ip = String(input).toLowerCase().replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!net.isIPv6(ip)) return null;

  // Fold a trailing dotted-quad (IPv4-mapped/compatible) into two hex groups.
  const v4 = ip.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const p = v4[2].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    ip = v4[1] + (((p[0] << 8) | p[1]).toString(16)) + ':' + (((p[2] << 8) | p[3]).toString(16));
  }

  const dbl = ip.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  let groups;
  if (dbl.length === 2) {
    const tail = dbl[1] ? dbl[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.map((h) => parseInt(h || '0', 16) & 0xffff);
}

/** True if an IP literal points somewhere we must never fetch from. */
export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  if (net.isIPv6(ip)) {
    const h = expandIpv6(ip);
    if (!h) return true;
    if (h.every((x) => x === 0)) return true; // :: unspecified
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 loopback
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96, deprecated):
    // judge by the embedded IPv4.
    if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
      return ipv4Blocked(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
    }
    const firstByte = h[0] >> 8;
    if (firstByte === 0xfc || firstByte === 0xfd) return true; // fc00::/7 unique-local
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }
  // URL IPv6 hostnames arrive bracketed (e.g. "[::1]") — strip and retry once.
  const stripped = String(ip).replace(/^\[|\]$/g, '');
  if (stripped !== String(ip) && net.isIP(stripped)) return isBlockedIp(stripped);
  return true; // not a valid IP — block
}

/**
 * Resolve a hostname and reject if it (or any of its addresses) points at a
 * private/internal/reserved range. An IP literal is checked directly. Used as
 * a fast up-front / per-redirect-hop check; `safeLookup` is the connection-time
 * authority.
 */
export async function assertSafeHost(host) {
  const bare = String(host).replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (isBlockedIp(bare)) {
      throw new LinkError('blocked_host', 'That URL points to a private or internal address.');
    }
    return;
  }
  let addrs;
  try {
    addrs = await dns.promises.lookup(bare, { all: true });
  } catch {
    throw new LinkError('dns', "Couldn't resolve that website's address.");
  }
  if (!addrs.length) {
    throw new LinkError('dns', "Couldn't resolve that website's address.");
  }
  for (const { address } of addrs) {
    if (isBlockedIp(address)) {
      throw new LinkError('blocked_host', 'That URL points to a private or internal address.');
    }
  }
}

/**
 * A `dns.lookup`-shaped function for an HTTP agent's `connect.lookup`. It
 * resolves the hostname, rejects if any resolved address is blocked, and
 * returns the validated address(es) — so the socket connects to exactly what
 * was validated (no re-resolution, no DNS-rebinding window). Honors the
 * caller's `all` option (undici requests the array form).
 */
export function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (options || {});
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: opts.family || 0 }];
    for (const a of list) {
      if (isBlockedIp(a.address)) {
        return cb(new LinkError('blocked_host', 'That URL points to a private or internal address.'));
      }
    }
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
