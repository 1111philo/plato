import { useEffect, useRef, useState } from 'react';
import { adminApi } from './adminApi.js';
import {
  FIELD_TYPE_OPTIONS, FIELD_VISIBILITY, fieldSummary, fieldVisibility, visibilityFlags,
} from '../../lib/userFields.js';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm';
const EMPTY_FORM = { label: '', type: 'text', required: false, options: '', visibility: 'everyone' };
const NEW = 'new'; // `editing` value while adding a field

/**
 * Admin → Users → "User Fields": admin-defined custom user fields (#364).
 *
 * Each field is one row: its label and a one-line summary ("Dropdown ·
 * Required · Everyone"), Move up / Move down, and Edit. Edit opens the editor
 * in place of the row; "Add field" opens it at the end of the list. One editor
 * at a time. The editor sets the label, type (and dropdown options), who can
 * see and fill it in (Everyone / Learners, after signup / Admins only, stored
 * as the server's `hideFromApi` / `hideFromLearner`), and Required (not for
 * admin-only fields). Delete lives in the editor, behind a confirmation.
 *
 * Changing a type is allowed; if stored answers wouldn't pass the new rules,
 * the server replies 409 with a count and we confirm first. Every change is
 * announced in a polite status region, and focus returns to the row's Edit
 * button (or Add field) when the editor closes.
 */
export default function UserFieldsDialog({ open, onOpenChange, fields, onChange }) {
  const [editing, setEditing] = useState(null); // field id, NEW, or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // field
  const [confirmInvalid, setConfirmInvalid] = useState(null); // { count, body }
  const labelRef = useRef(null);
  // Where focus goes after the next render (the list has re-rendered by then).
  const focusTarget = useRef(null);
  const [focusTick, setFocusTick] = useState(0);
  const setFocusId = (id) => { focusTarget.current = id; setFocusTick((n) => n + 1); };

  useEffect(() => {
    if (!focusTarget.current) return;
    document.getElementById(focusTarget.current)?.focus();
    focusTarget.current = null;
  }, [focusTick, fields, editing]);

  useEffect(() => { if (editing) labelRef.current?.focus(); }, [editing]);

  function close(returnTo) {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    if (returnTo) setFocusId(returnTo);
  }

  function startEdit(f) {
    setEditing(f.id);
    setForm({ label: f.label, type: f.type, required: !!f.required, options: (f.options || []).join('\n'), visibility: fieldVisibility(f) });
    setError('');
  }

  function startAdd() {
    setEditing(NEW);
    setForm(EMPTY_FORM);
    setError('');
  }

  async function run(fn, done) {
    setSaving(true);
    setError('');
    try {
      const data = await fn();
      onChange(data.userFields || []);
      if (done) setAnnouncement(done);
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  function bodyFromForm() {
    const flags = visibilityFlags(form.visibility);
    return {
      label: form.label,
      type: form.type,
      // A field only admins see can't be required of learners (the server agrees).
      required: form.required && !flags.hideFromLearner,
      ...flags,
      options: form.type === 'dropdown' ? form.options.split('\n') : undefined,
    };
  }

  async function save(body, { confirmed = false } = {}) {
    const label = body.label.trim();
    if (editing === NEW) {
      const data = await run(() => adminApi('POST', '/v1/admin/user-fields', body), `Added ${label}.`);
      if (data) {
        const added = (data.userFields || []).find((f) => f.label === label);
        close(added ? `field-${added.id}-edit` : 'user-fields-add');
      }
      return;
    }
    const id = editing;
    const path = `/v1/admin/user-fields/${id}`;
    setSaving(true);
    setError('');
    try {
      const data = await adminApi('PUT', path, confirmed ? { ...body, confirmInvalid: true } : body);
      onChange(data.userFields || []);
      setAnnouncement(`Saved ${label}.`);
      close(`field-${id}-edit`);
    } catch (err) {
      // A new type (or fewer dropdown options) can leave stored answers that
      // no longer pass; the server reports how many and waits for a yes.
      if (err.status === 409 && err.data?.invalidCount && !confirmed) setConfirmInvalid({ count: err.data.invalidCount, body });
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(f) {
    const data = await run(() => adminApi('DELETE', `/v1/admin/user-fields/${f.id}`), `Deleted ${f.label}.`);
    if (data) close('user-fields-add');
  }

  function move(idx, delta) {
    const ids = fields.map((f) => f.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(idx + delta, 0, moved);
    const f = fields[idx];
    run(() => adminApi('PUT', '/v1/admin/user-fields/order', { ids }), `Moved ${f.label} ${delta < 0 ? 'up' : 'down'}.`).then((data) => {
      if (!data) return;
      // Keep focus on the pressed button, or its opposite at either end.
      const at = idx + delta;
      const dir = delta < 0 ? 'up' : 'down';
      const edge = (dir === 'up' && at === 0) || (dir === 'down' && at === fields.length - 1);
      setFocusId(`field-${f.id}-${edge ? (dir === 'up' ? 'down' : 'up') : dir}`);
    });
  }

  const isAdminOnly = form.visibility === 'admins';
  const editor = (
    <form
      className="space-y-4 rounded-lg border bg-background p-3"
      onSubmit={(e) => { e.preventDefault(); save(bodyFromForm()); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(editing === NEW ? 'user-fields-add' : `field-${editing}-edit`); } }}
      aria-labelledby="user-field-form-heading"
    >
      <h3 id="user-field-form-heading" className="text-sm font-semibold">{editing === NEW ? 'New field' : `Edit ${fields.find((f) => f.id === editing)?.label || 'field'}`}</h3>
      {error && <p className="text-sm text-red-800 dark:text-destructive" role="alert">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1.5">
          <Label htmlFor="user-field-label">Label</Label>
          <Input id="user-field-label" ref={labelRef} value={form.label} maxLength={80}
            onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-field-type">Type</Label>
          <select id="user-field-type" className={SELECT_CLASS} value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {FIELD_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {form.type === 'dropdown' && (
        <div className="space-y-1.5">
          <Label htmlFor="user-field-options">Options</Label>
          <Textarea id="user-field-options" rows={4} value={form.options} aria-describedby="user-field-options-hint"
            onChange={(e) => setForm({ ...form, options: e.target.value })} />
          <p id="user-field-options-hint" className="text-xs text-muted-foreground">One option per line.</p>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Who can see and fill it in</legend>
        {FIELD_VISIBILITY.map((v) => (
          <label key={v.value} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50">
            <input type="radio" name="user-field-visibility" value={v.value} className="mt-1 h-4 w-4 shrink-0 accent-primary"
              checked={form.visibility === v.value} aria-describedby={`user-field-vis-${v.value}`}
              onChange={() => setForm({ ...form, visibility: v.value })} />
            <span>
              <span className="block text-sm">{v.label}</span>
              <span id={`user-field-vis-${v.value}`} className="block text-xs text-muted-foreground">{v.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {!isAdminOnly && (
        <label className="flex cursor-pointer items-start gap-2">
          <input id="user-field-required" type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={form.required}
            aria-describedby="user-field-required-hint" onChange={(e) => setForm({ ...form, required: e.target.checked })} />
          <span>
            <span className="block text-sm">Required</span>
            <span id="user-field-required-hint" className="block text-xs text-muted-foreground">
              {form.visibility === 'learners'
                ? 'Learners are asked for it the first time they open their lessons.'
                : 'Asked at signup and on the wait-list form. Anyone missing it is asked before their lessons.'}
            </span>
          </span>
        </label>
      )}

      {editing !== NEW && form.visibility === 'everyone' && (
        <p className="text-xs text-muted-foreground">
          Field ID for the wait-list API: <code className="rounded bg-muted px-1">{editing}</code>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || !form.label.trim()}>{editing === NEW ? 'Add field' : 'Save'}</Button>
        <Button type="button" variant="outline" onClick={() => close(editing === NEW ? 'user-fields-add' : `field-${editing}-edit`)}>Cancel</Button>
        {editing !== NEW && (
          <Button type="button" variant="ghost" className="ml-auto text-red-800 hover:text-red-900 dark:text-destructive"
            disabled={saving} onClick={() => setConfirmDelete(fields.find((f) => f.id === editing))}>
            Delete field
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>User Fields</DialogTitle>
          <DialogDescription>
            Extra profile questions, such as organization or role. You choose who sees each one.
          </DialogDescription>
        </DialogHeader>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

        <div className="min-w-0 space-y-3">
          {fields.length > 0 ? (
            <ul className="space-y-1.5" aria-label="Custom user fields">
              {fields.map((f, idx) => (
                <li key={f.id}>
                  {editing === f.id ? editor : (
                    <div className="flex items-center gap-1 rounded-md bg-muted/50 py-2 pl-3 pr-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{f.label}</p>
                        <p className="truncate text-xs text-muted-foreground">{fieldSummary(f)}</p>
                      </div>
                      <Button id={`field-${f.id}-up`} variant="ghost" size="icon-xs" aria-label={`Move ${f.label} up`} disabled={saving || !!editing || idx === 0} onClick={() => move(idx, -1)}>&uarr;</Button>
                      <Button id={`field-${f.id}-down`} variant="ghost" size="icon-xs" aria-label={`Move ${f.label} down`} disabled={saving || !!editing || idx === fields.length - 1} onClick={() => move(idx, 1)}>&darr;</Button>
                      <Button id={`field-${f.id}-edit`} variant="ghost" size="sm" aria-label={`Edit ${f.label}`} disabled={saving || !!editing} onClick={() => startEdit(f)}>Edit</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            editing !== NEW && <p className="text-sm text-muted-foreground">No fields yet.</p>
          )}

          {editing === NEW ? editor : (
            <Button id="user-fields-add" variant="outline" onClick={startAdd} disabled={saving || !!editing}>Add field</Button>
          )}
        </div>

        <ConfirmModal
          open={!!confirmDelete}
          onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
          title={`Delete ${confirmDelete?.label || 'this field'}?`}
          message="Every user's answer to it is erased. This can't be undone."
          confirmLabel="Delete field"
          onConfirm={() => { const f = confirmDelete; setConfirmDelete(null); remove(f); }}
        />
        <ConfirmModal
          open={!!confirmInvalid}
          onOpenChange={(o) => { if (!o) setConfirmInvalid(null); }}
          title="Some answers won't fit"
          message={confirmInvalid ? `${confirmInvalid.count} existing ${confirmInvalid.count === 1 ? "answer doesn't" : "answers don't"} fit the new type or options. They're kept, but must be fixed the next time they're edited.` : ''}
          confirmLabel="Save anyway"
          variant="default"
          onConfirm={() => { const c = confirmInvalid; setConfirmInvalid(null); save(c.body, { confirmed: true }); }}
        />
      </DialogContent>
    </Dialog>
  );
}
