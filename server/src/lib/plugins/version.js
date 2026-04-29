/**
 * Plugin API version contract.
 *
 * Bump major when removing/renaming a hook, slot, or capability.
 * Bump minor when adding a new hook, slot, or capability.
 * Bump patch for bug fixes.
 *
 * Plugin manifests declare an `apiVersion` semver range; if the host's version
 * doesn't satisfy it, the plugin is refused with `plugin_api_mismatch`.
 *
 * Kept dependency-free: implements just enough semver-range matching for our
 * range syntax (`X.Y.Z`, `X.x`, `X.Y.x`, `^X.Y.Z`, `~X.Y.Z`). For anything more
 * exotic we'd add a real semver library.
 */

export const PLUGIN_API_VERSION = '1.2.0';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/;

function parseVersion(v) {
  const m = SEMVER.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}

/** Return true iff the host version satisfies the plugin's apiVersion range. */
export function satisfies(hostVersion, range) {
  const host = parseVersion(hostVersion);
  if (!host) return false;
  const r = String(range || '').trim();
  if (!r) return false;

  // Exact match: "1.2.3"
  const exact = parseVersion(r);
  if (exact) {
    return host.major === exact.major && host.minor === exact.minor && host.patch === exact.patch;
  }

  // Caret: ^1.2.3 — same major, >= 1.2.3
  if (r.startsWith('^')) {
    const v = parseVersion(r.slice(1));
    if (!v) return false;
    if (host.major !== v.major) return false;
    if (host.minor > v.minor) return true;
    if (host.minor < v.minor) return false;
    return host.patch >= v.patch;
  }

  // Tilde: ~1.2.3 — same major+minor, >= 1.2.3
  if (r.startsWith('~')) {
    const v = parseVersion(r.slice(1));
    if (!v) return false;
    if (host.major !== v.major || host.minor !== v.minor) return false;
    return host.patch >= v.patch;
  }

  // Wildcard: "1.x" or "1.2.x"
  const wildcard = /^(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?$/i.exec(r);
  if (wildcard) {
    const major = +wildcard[1];
    const minorTok = wildcard[2];
    const patchTok = wildcard[3];
    if (host.major !== major) return false;
    if (minorTok && minorTok.toLowerCase() !== 'x') {
      if (host.minor !== +minorTok) return false;
    }
    if (patchTok && patchTok.toLowerCase() !== 'x') {
      if (host.patch !== +patchTok) return false;
    }
    return true;
  }

  return false;
}
