// Column layout for admin tables (#385): which columns show and in what
// order, saved per browser in localStorage. Pure helpers (storage passed in)
// so they're tested in client/tests/tableColumns.test.js.

/**
 * `columns`: `[{ id, label, fixed?, defaultHidden? }]` in default order.
 * `fixed` columns (the row's name/open button, the actions) always show,
 * in place. Prefs: `{ order: [ids], hidden: [ids] }`.
 */
export function defaultPrefs(columns) {
  return { order: columns.map((c) => c.id), hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id) };
}

/** Saved prefs reconciled with the current columns: new ones appear in default place, gone ones drop. */
export function reconcile(columns, prefs) {
  const base = defaultPrefs(columns);
  if (!prefs || !Array.isArray(prefs.order)) return base;
  const ids = new Set(columns.map((c) => c.id));
  const order = prefs.order.filter((id) => ids.has(id));
  base.order.forEach((id, i) => {
    if (order.includes(id)) return;
    // Insert after the last (in the saved order) of the columns that come
    // before it by default.
    const at = Math.max(-1, ...base.order.slice(0, i).map((p) => order.indexOf(p)));
    order.splice(at + 1, 0, id);
  });
  const known = new Set(prefs.order);
  const hidden = [
    ...(Array.isArray(prefs.hidden) ? prefs.hidden : []).filter((id) => ids.has(id)),
    ...base.hidden.filter((id) => !known.has(id)), // new columns keep their default
  ];
  return { order, hidden: [...new Set(hidden)] };
}

/** The columns to render, in order. Fixed columns can't be hidden and keep their default slot at the ends. */
export function visibleColumns(columns, prefs) {
  const p = reconcile(columns, prefs);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const lead = columns.filter((c, i) => c.fixed && i === 0);
  const tail = columns.filter((c, i) => c.fixed && i !== 0);
  const middle = p.order.map((id) => byId.get(id)).filter((c) => !c.fixed && !p.hidden.includes(c.id));
  return [...lead, ...middle, ...tail];
}

/** The movable columns, in order, with `hidden` (for the Columns dialog). */
export function arrangeable(columns, prefs) {
  const p = reconcile(columns, prefs);
  const byId = new Map(columns.map((c) => [c.id, c]));
  return p.order.map((id) => byId.get(id)).filter((c) => !c.fixed).map((c) => ({ ...c, hidden: p.hidden.includes(c.id) }));
}

export function toggleColumn(columns, prefs, id, show) {
  const p = reconcile(columns, prefs);
  const hidden = show ? p.hidden.filter((h) => h !== id) : [...new Set([...p.hidden, id])];
  return { ...p, hidden };
}

/** Move a column one place among the movable ones. */
export function moveColumn(columns, prefs, id, delta) {
  const p = reconcile(columns, prefs);
  const movable = arrangeable(columns, p).map((c) => c.id);
  const i = movable.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= movable.length) return p;
  [movable[i], movable[j]] = [movable[j], movable[i]];
  const fixed = p.order.filter((x) => !movable.includes(x));
  return { ...p, order: [...fixed, ...movable] };
}

export function loadPrefs(key, storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
}

export function savePrefs(key, prefs, storage = globalThis.localStorage) {
  try { storage?.setItem(key, JSON.stringify(prefs)); } catch { /* private mode, quota */ }
}
