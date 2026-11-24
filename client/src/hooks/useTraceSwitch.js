/**
 * The Trace switch for one conversation (#595): `{ on, byTeam, set }`.
 * `scope` is a lesson id, `profile`, `kb`, or `author-<lessonId>`. A person
 * turns Trace on per conversation (lessonTrace.isTraceOn); when an admin has
 * turned it on for them, it is on everywhere and `byTeam` is true. Off while
 * viewing as a learner: an admin reads, never records.
 */
import { useState } from 'react';
import { useApp } from '../contexts/AppContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { savePreferences } from '../../js/storage.js';
import { syncIfUnsaved } from '../lib/syncDebounce.js';
import { isTraceOn, withTraceScope } from '../lib/lessonTrace.js';

export default function useTraceSwitch(scope, { readOnly = false } = {}) {
  const { state, dispatch } = useApp();
  const { user } = useAuth();
  const [error, setError] = useState('');
  const byTeam = !readOnly && !!user?.traceMode;
  const on = !readOnly && isTraceOn({ preferences: state.preferences, user }, scope);

  async function set(next) {
    if (readOnly || byTeam) return;
    const preferences = withTraceScope(state.preferences, scope, next);
    dispatch({ type: 'SET_PREFERENCES', preferences });
    setError('');
    try {
      syncIfUnsaved(await savePreferences(preferences), 'preferences');
    } catch {
      setError('Couldn’t save. Try again.');
    }
  }

  return { on, byTeam, set, error, readOnly };
}
