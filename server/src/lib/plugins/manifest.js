/**
 * Manifest validation. Hand-rolled (no JSON Schema runtime dep) but mirrors
 * docs/plugins/plugin.schema.json — keep them in sync.
 *
 * Returns `{ ok: true, manifest }` on success or `{ ok: false, errors: [...] }`
 * on failure. Errors are short, human-readable strings naming the offending
 * field; the registry concatenates them into a `plugin_manifest_invalid` log.
 */

import { isValidCapability, missingCapabilities } from './capabilities.js';

const ID_RE = /^[a-z][a-z0-9-]{1,49}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
const ROUTES_RE = /^server\/[^#]+\.js#[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const SLOT_FILE_RE = /^client\/.+\.(jsx?|tsx?)$/;
const SLOT_NAMES = new Set([
  'adminSettingsPanel',
  'adminUserRowAction',
  'adminHomeKpi',
  'adminProfileFields',
  'learnerProfileFields',
  'learnerHomeBanner',
]);
const HOOK_NAMES = new Set([
  'userCreated',
  'userUpdated',
  'profileUpdated',
  'lessonStarted',
  'lessonCompleted',
  'coachExchangeRecorded',
]);

export function validateManifest(raw, { expectedId } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['manifest is not an object'] };
  }

  const required = ['id', 'name', 'version', 'apiVersion', 'description', 'capabilities', 'extensionPoints'];
  for (const key of required) {
    if (!(key in raw)) errors.push(`missing required field: ${key}`);
  }

  if (typeof raw.id === 'string' && !ID_RE.test(raw.id)) errors.push(`id "${raw.id}" must match ${ID_RE}`);
  if (expectedId && raw.id !== expectedId) {
    errors.push(`id "${raw.id}" does not match directory name "${expectedId}"`);
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > 80) {
    errors.push('name must be a non-empty string ≤ 80 chars');
  }
  if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) {
    errors.push(`version "${raw.version}" must be semver (X.Y.Z[-pre])`);
  }
  if (typeof raw.apiVersion !== 'string' || !raw.apiVersion.length) {
    errors.push('apiVersion must be a non-empty string');
  }
  if (typeof raw.description !== 'string' || raw.description.length === 0 || raw.description.length > 280) {
    errors.push('description must be a non-empty string ≤ 280 chars');
  }
  if (raw.builtIn !== undefined && typeof raw.builtIn !== 'boolean') {
    errors.push('builtIn must be a boolean if present');
  }
  if (raw.defaultEnabled !== undefined && typeof raw.defaultEnabled !== 'boolean') {
    errors.push('defaultEnabled must be a boolean if present');
  }

  if (!Array.isArray(raw.capabilities)) {
    errors.push('capabilities must be an array');
  } else {
    for (const cap of raw.capabilities) {
      if (!isValidCapability(cap)) errors.push(`unknown capability: ${cap}`);
    }
  }

  if (!raw.extensionPoints || typeof raw.extensionPoints !== 'object') {
    errors.push('extensionPoints must be an object');
  } else {
    const ep = raw.extensionPoints;
    if (ep.serverRoutes !== undefined && !ROUTES_RE.test(ep.serverRoutes)) {
      errors.push(`extensionPoints.serverRoutes must match "server/<file>.js#<exportName>"; got "${ep.serverRoutes}"`);
    }
    if (ep.slots !== undefined) {
      if (typeof ep.slots !== 'object' || ep.slots === null) {
        errors.push('extensionPoints.slots must be an object');
      } else {
        for (const [slotName, filePath] of Object.entries(ep.slots)) {
          if (!SLOT_NAMES.has(slotName)) errors.push(`unknown slot name: ${slotName}`);
          if (typeof filePath !== 'string' || !SLOT_FILE_RE.test(filePath)) {
            errors.push(`slot "${slotName}" file "${filePath}" must match client/<path>.{js,jsx,ts,tsx}`);
          }
        }
      }
    }
    if (ep.hooks !== undefined) {
      if (!Array.isArray(ep.hooks)) {
        errors.push('extensionPoints.hooks must be an array');
      } else {
        for (const h of ep.hooks) {
          if (!HOOK_NAMES.has(h)) errors.push(`unknown hook: ${h}`);
        }
      }
    }
  }

  if (errors.length === 0) {
    const missing = missingCapabilities(raw);
    if (missing.length) {
      errors.push(`extensionPoints declare capabilities not listed in "capabilities": ${missing.join(', ')}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: raw };
}
