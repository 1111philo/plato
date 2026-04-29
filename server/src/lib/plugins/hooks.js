/**
 * Tiny pub-sub for plugin hooks. Modeled on WordPress do_action/add_action.
 *
 * Open by design: any event name is allowed. Core emits a known subset (per
 * docs/plugins/EXTENSION_REFERENCE.md); plugins MAY emit/subscribe to arbitrary
 * names following the convention `<plugin-id>.<event>`. This lets plugin A
 * extend plugin B without waiting for core to add a new hook.
 */

import { logger } from '../logger.js';

const handlers = new Map();

/** Subscribe a handler to an event. Returns an unsubscribe function. */
export function on(event, fn, meta = {}) {
  if (typeof event !== 'string' || !event) throw new Error('event name required');
  if (typeof fn !== 'function') throw new Error('handler must be a function');
  if (!handlers.has(event)) handlers.set(event, []);
  const entry = { fn, meta };
  handlers.get(event).push(entry);
  return () => {
    const list = handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(entry);
    if (idx >= 0) list.splice(idx, 1);
  };
}

/**
 * Fire an event. Each handler runs to completion (errors logged but do not
 * stop other handlers). Awaitable; resolves once every handler has finished.
 */
export async function emit(event, payload) {
  const list = handlers.get(event);
  if (!list || list.length === 0) return;
  // Snapshot in case a handler unsubscribes during iteration.
  for (const entry of [...list]) {
    try {
      await entry.fn(payload);
    } catch (err) {
      logger.error('plugin_hook_failed', {
        event,
        pluginId: entry.meta?.pluginId || 'unknown',
        error: err?.message || String(err),
        stack: err?.stack,
      });
    }
  }
}

/** Test-only: clear all handlers. */
export function _reset() {
  handlers.clear();
}

/** Inspection helper for tests / the extension-points endpoint. */
export function listEvents() {
  return [...handlers.keys()].sort();
}

/** Count of handlers registered for `event`. */
export function handlerCount(event) {
  return (handlers.get(event) || []).length;
}
