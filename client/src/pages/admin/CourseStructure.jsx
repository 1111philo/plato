import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from './adminApi.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import ConfirmModal from '../../components/modals/ConfirmModal.jsx';

const NAME_MAX = 80;
const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm';

/**
 * Admin → Lessons → Courses & Units (#408): the Course → Unit → Lesson
 * structure in one place. Add, rename, and delete courses and units; put a
 * unit in a course; order units within a course and lessons within a unit.
 * Lessons themselves are created and edited in the lesson editor.
 *
 * Reordering uses Move up / Move down buttons (keyboard and screen reader
 * friendly, no drag-and-drop). Focus stays on the moved item's button and
 * each change is announced in a polite live region. Storage mapping:
 * server/src/lib/hierarchy.js.
 */
export default function CourseStructure() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [units, setUnits] = useState(new Map());
  const [unassigned, setUnassigned] = useState([]);
  const [lessonNames, setLessonNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [editing, setEditing] = useState(null); // { kind: 'program'|'unit', id, name, programId? }
  const [confirm, setConfirm] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  // Set only after the reloaded data renders, so focus lands on the moved
  // item's button in its new position (a focus request made earlier is lost
  // when React moves the row).
  const [focusRequest, setFocusRequest] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, u, l] = await Promise.all([
        adminApi('GET', '/v1/admin/programs'),
        adminApi('GET', '/v1/admin/units'),
        adminApi('GET', '/v1/admin/lessons'),
      ]);
      setPrograms(p.programs || []);
      setUnassigned(p.unassignedUnitIds || []);
      setUnits(new Map((Array.isArray(u) ? u : []).map((x) => [x.unitId, x])));
      setLessonNames(new Map((Array.isArray(l) ? l : []).map((x) => [x.lessonId, x.name || x.lessonId])));
      setError('');
    } catch (e) {
      setError(e.message || 'Failed to load courses and units.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { document.title = 'Courses & Units — Admin'; load(); }, [load]);

  // Keep keyboard focus on the button that was pressed after the list re-renders.
  useEffect(() => {
    if (!focusRequest) return;
    const { id } = focusRequest;
    const el = document.getElementById(id);
    // Moved to the top or bottom, so the pressed button is now disabled: land
    // on the opposite move button so the same item can keep moving.
    const opposite = document.getElementById(id.replace(/-(up|down)$/, (_, d) => (d === 'up' ? '-down' : '-up')));
    if (el && !el.disabled) el.focus();
    else if (opposite && !opposite.disabled) opposite.focus();
    else el?.closest('li')?.querySelector('button:not([disabled])')?.focus();
  }, [focusRequest]);

  async function run(fn, done, focusId) {
    setError('');
    try {
      await fn();
      if (done) setAnnouncement(done);
      await load();
      // A fresh object each time, so repeating the same move refocuses.
      if (focusId) setFocusRequest((prev) => ({ id: focusId, n: (prev?.n || 0) + 1 }));
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    }
  }

  const move = (list, index, delta) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    return next;
  };

  function moveUnit(program, index, delta) {
    const unitId = program.unitIds[index];
    const name = units.get(unitId)?.name || 'Unit';
    run(() => adminApi('PUT', `/v1/admin/programs/${program.programId}/order`, { unitIds: move(program.unitIds, index, delta) }),
      `Moved ${name} ${delta < 0 ? 'up' : 'down'}.`, `unit-${unitId}-${delta < 0 ? 'up' : 'down'}`);
  }

  function moveLesson(unit, index, delta) {
    const lessonId = unit.lessonIds[index];
    run(() => adminApi('PUT', `/v1/admin/units/${unit.unitId}/order`, { lessonIds: move(unit.lessonIds, index, delta) }),
      `Moved ${lessonNames.get(lessonId) || 'lesson'} ${delta < 0 ? 'up' : 'down'}.`, `lesson-${lessonId}-${delta < 0 ? 'up' : 'down'}`);
  }

  function saveEditing(e) {
    e.preventDefault();
    const name = editing.name.trim();
    if (!name) { setError('Name is required.'); return; }
    if (editing.kind === 'program') {
      const id = editing.id || newId('prog');
      run(() => adminApi('PUT', `/v1/admin/programs/${id}`, { name }), editing.id ? `Renamed course to ${name}.` : `Added course ${name}.`);
    } else {
      const id = editing.id || newId('course');
      const body = { name, ...(editing.id ? {} : { programId: editing.programId || null }) };
      run(() => adminApi('PUT', `/v1/admin/units/${id}`, body), editing.id ? `Renamed unit to ${name}.` : `Added unit ${name}.`);
    }
    setEditing(null);
  }

  function moveUnitToCourse(unit, programId) {
    const course = programs.find((p) => p.programId === programId);
    run(() => adminApi('PUT', `/v1/admin/units/${unit.unitId}`, { name: unit.name, programId: programId || null }),
      programId ? `Moved ${unit.name} to ${course?.name}.` : `${unit.name} is no longer in a course.`);
  }

  const toggle = (unitId) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(unitId)) next.delete(unitId); else next.add(unitId);
    return next;
  });

  // Render helpers, not components: a component defined in the body is a
  // new type each render, which would remount the input while typing.
  function nameForm(label) {
    return (
      <form onSubmit={saveEditing} className="flex flex-wrap items-center gap-2" aria-label={label}>
        <Input
          aria-label={label}
          autoFocus
          value={editing.name}
          maxLength={NAME_MAX}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
          className="h-8 w-64 max-w-full"
        />
        <Button type="submit" size="sm">Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
      </form>
    );
  }

  function unitItem(unitId, program, index) {
    const unit = units.get(unitId);
    if (!unit) return null;
    const open = expanded.has(unitId);
    const isEditing = editing?.kind === 'unit' && editing.id === unitId;
    const count = unit.lessonIds.length;
    return (
      <li key={unitId} className="rounded-md border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {isEditing ? nameForm(`Rename unit ${unit.name}`) : (
            <>
              <button
                type="button"
                onClick={() => toggle(unitId)}
                aria-expanded={open}
                aria-controls={`unit-${unitId}-lessons`}
                className="flex-1 min-w-0 text-left font-medium cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span aria-hidden="true" className="inline-block w-4 text-muted-foreground">{open ? '▾' : '▸'}</span>
                {unit.name} <span className="text-sm font-normal text-muted-foreground">· {count} lesson{count === 1 ? '' : 's'}</span>
              </button>
              {program && (
                <>
                  <Button id={`unit-${unitId}-up`} variant="ghost" size="icon-xs" disabled={index === 0} onClick={() => moveUnit(program, index, -1)} aria-label={`Move ${unit.name} up`}>&uarr;</Button>
                  <Button id={`unit-${unitId}-down`} variant="ghost" size="icon-xs" disabled={index === program.unitIds.length - 1} onClick={() => moveUnit(program, index, 1)} aria-label={`Move ${unit.name} down`}>&darr;</Button>
                </>
              )}
              <select
                aria-label={`Course for ${unit.name}`}
                value={unit.programId || ''}
                onChange={(e) => moveUnitToCourse(unit, e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">No course</option>
                {programs.map((p) => <option key={p.programId} value={p.programId}>{p.name}</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'unit', id: unitId, name: unit.name })} aria-label={`Rename ${unit.name}`}>Rename</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'unit', id: unitId, name: unit.name, count })} aria-label={`Delete ${unit.name}`}>Delete</Button>
            </>
          )}
        </div>
        {open && (
          <div id={`unit-${unitId}-lessons`} className="mt-2 pl-4">
            {count === 0 ? (
              <p className="text-sm text-muted-foreground">No lessons yet. Choose this unit in a lesson’s editor to add one.</p>
            ) : (
              <ol className="space-y-1" aria-label={`Lessons in ${unit.name}`}>
                {unit.lessonIds.map((lessonId, i) => (
                  <li key={lessonId} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-right text-muted-foreground tabular-nums" aria-hidden="true">{i + 1}.</span>
                    <button type="button" onClick={() => navigate(`/plato/lessons/${encodeURIComponent(lessonId)}/edit`)} className="flex-1 min-w-0 text-left hover:underline cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                      {lessonNames.get(lessonId) || lessonId}
                    </button>
                    <Button id={`lesson-${lessonId}-up`} variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => moveLesson(unit, i, -1)} aria-label={`Move ${lessonNames.get(lessonId)} up`}>&uarr;</Button>
                    <Button id={`lesson-${lessonId}-down`} variant="ghost" size="icon-xs" disabled={i === count - 1} onClick={() => moveLesson(unit, i, 1)} aria-label={`Move ${lessonNames.get(lessonId)} down`}>&darr;</Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </li>
    );
  }

  function addUnit(programId) {
    const adding = editing?.kind === 'unit' && !editing.id && (editing.programId || null) === (programId || null);
    return adding
      ? nameForm('New unit name')
      : <Button variant="outline" size="sm" onClick={() => setEditing({ kind: 'unit', id: null, name: '', programId })}>Add unit</Button>;
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-muted-foreground" role="status">Loading...</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/plato/lessons')} aria-label="Back to lessons">&larr; Lessons</Button>
        <h1 className="text-2xl font-bold">Courses &amp; Units</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Courses are made of units, and units are made of lessons. Learners see them in this order.
      </p>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}

      <div className="mb-4">
        {editing?.kind === 'program' && !editing.id
          ? nameForm('New course name')
          : <Button onClick={() => setEditing({ kind: 'program', id: null, name: '' })}>Add course</Button>}
      </div>

      <div className="space-y-4">
        {programs.map((program) => {
          const isEditing = editing?.kind === 'program' && editing.id === program.programId;
          return (
            <Card key={program.programId}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isEditing ? nameForm(`Rename course ${program.name}`) : (
                    <>
                      <h2 className="flex-1 min-w-0 text-lg font-semibold">{program.name}</h2>
                      <span className="text-sm text-muted-foreground">{program.unitCount} unit{program.unitCount === 1 ? '' : 's'} · {program.lessonCount} lesson{program.lessonCount === 1 ? '' : 's'}</span>
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ kind: 'program', id: program.programId, name: program.name })} aria-label={`Rename course ${program.name}`}>Rename</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'program', id: program.programId, name: program.name, count: program.unitCount })} aria-label={`Delete course ${program.name}`}>Delete</Button>
                    </>
                  )}
                </div>
                {program.unitIds.length > 0 && (
                  <ol className="space-y-2" aria-label={`Units in ${program.name}`}>
                    {program.unitIds.map((unitId, index) => unitItem(unitId, program, index))}
                  </ol>
                )}
                {addUnit(program.programId)}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-lg font-semibold">Units not in a course</h2>
            {unassigned.length > 0 ? (
              <ul className="space-y-2" aria-label="Units not in a course">
                {unassigned.map((unitId) => unitItem(unitId, null, 0))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Every unit is in a course.</p>}
            {addUnit(null)}
          </CardContent>
        </Card>
      </div>

      {confirm && (
        <ConfirmModal
          open
          onOpenChange={(o) => { if (!o) setConfirm(null); }}
          title={confirm.kind === 'program' ? `Delete course "${confirm.name}"?` : `Delete unit "${confirm.name}"?`}
          message={confirm.kind === 'program'
            ? `Its ${confirm.count} unit${confirm.count === 1 ? '' : 's'} will stay, moved to "Units not in a course". No lessons are deleted.`
            : `Its ${confirm.count} lesson${confirm.count === 1 ? '' : 's'} will stay, no longer in a unit. Learners' progress is kept.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            run(() => adminApi('DELETE', c.kind === 'program' ? `/v1/admin/programs/${c.id}` : `/v1/admin/units/${c.id}`), `Deleted ${c.name}.`);
          }}
        />
      )}
    </div>
  );
}
