/**
 * Trace on or off for one conversation (#595): `{ on, set, error }`.
 * `scope` is a lesson id or `profile`. Start trace and Stop trace in the
 * Trace (TraceContent.jsx) set it (lessonTrace.isTraceOn).
 */
import { useState } from 'react';
import { useApp } from '../contexts/AppContext.jsx';
import { savePreferences } from '../../js/storage.js';
import { syncIfUnsaved } from '../lib/syncDebounce.js';
import { isTraceOn, withTraceScope } from '../lib/lessonTrace.js';

export default function useTraceSwitch(scope) {
  const { state, dispatch } = useApp();
  const [error, setError] = useState('');
  const on = isTraceOn(state.preferences, scope);

  async function set(next) {
    const preferences = withTraceScope(state.preferences, scope, next);
    dispatch({ type: 'SET_PREFERENCES', preferences });
    setError('');
    try {
      syncIfUnsaved(await savePreferences(preferences), 'preferences');
    } catch {
      setError('Couldn’t save. Try again.');
    }
  }

  return { on, set, error };
}
