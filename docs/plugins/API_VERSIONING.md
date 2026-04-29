# API versioning

Plato's plugin API is versioned with semver. The host declares a single `PLUGIN_API_VERSION`; each plugin manifest declares an `apiVersion` semver range.

## Current host version

```
PLUGIN_API_VERSION = '1.0.0'
```

Defined in `server/src/lib/plugins/version.js`.

## Plugin manifest

```json
{
  "apiVersion": "1.x"
}
```

Supported range syntax:

- Exact: `"1.0.0"`
- Caret: `"^1.0.0"` (same major, ≥ X.Y.Z)
- Tilde: `"~1.2.0"` (same major+minor, ≥ X.Y.Z)
- Wildcard: `"1.x"`, `"1.2.x"`

If the host's version doesn't satisfy the plugin's range, the plugin is refused at boot with `plugin_api_mismatch` and skipped (the host stays up; other plugins continue loading).

## Semver policy

| Change type | Bump |
|---|---|
| Remove or rename a slot, hook, or capability | major |
| Change the payload shape of a hook or props of a slot in a breaking way | major |
| Remove or rename an SDK re-export | major |
| Change the manifest schema in a way that invalidates existing manifests | major |
| Add a new slot, hook, capability, or SDK export | minor |
| Add an optional manifest field | minor |
| Bug fix that doesn't change the contract | patch |

Plugins targeting `^1.0.0` will keep working through every minor and patch release in the 1.x line.

## Deprecation window

When a slot/hook/capability is deprecated:

1. It keeps working for one full major-version cycle.
2. Each invocation logs `plugin_deprecated_api` with the plugin id and the deprecated name. This shows up in `/v1/admin/logs` for the maintainer.
3. The next major version removes it. Plugins that still target the old major continue running on the old major; plugins that move to the new major must migrate.

## What's not covered by versioning

- Plugin-internal data shape (your plugin's settings record, your sync-data writes). You own that contract.
- The open hook bus event names for plugin-to-plugin events. The convention `<plugin-id>.<event>` means the emitter owns the contract.
- Implementation details (e.g. how the registry stores activation state). The contract is the SDK + extension reference, not the source code.

## Compatibility table

| Host range | Plugin `apiVersion` | Status |
|---|---|---|
| 1.0.0 | `"1.x"` | ✅ |
| 1.0.0 | `"^1.0.0"` | ✅ |
| 1.0.0 | `"^1.1.0"` | ❌ — 1.0.0 doesn't satisfy ≥1.1.0 |
| 1.2.0 | `"^1.0.0"` | ✅ |
| 1.2.0 | `"~1.0.0"` | ❌ — `~1.0.0` requires 1.0.x |
| 2.0.0 | `"^1.0.0"` | ❌ — major mismatch |
| 2.0.0 | `"^2.0.0"` | ✅ |
| 2.0.0 | `"1.x"` | ❌ — major mismatch |

## When the host bumps

Plato follows the same versioning policy as the rest of the codebase (`Beta-RC-N` tags). The plugin API version is decoupled from the plato release version — only changes to the plugin contract bump it.
