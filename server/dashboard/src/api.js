const API = '';

let _apiCount = 0;
let _onLoadingChange = null;

export function setLoadingCallback(cb) {
  _onLoadingChange = cb;
}

function showLoading() {
  _apiCount++;
  if (_onLoadingChange) _onLoadingChange(true);
}

function hideLoading() {
  _apiCount = Math.max(0, _apiCount - 1);
  if (_apiCount === 0 && _onLoadingChange) _onLoadingChange(false);
}

function getAuth() {
  try {
    return JSON.parse(localStorage.getItem('ls_auth') || 'null');
  } catch {
    return null;
  }
}

function setAuthStorage(data) {
  localStorage.setItem('ls_auth', JSON.stringify(data));
}

function clearAuthStorage() {
  localStorage.removeItem('ls_auth');
}

let _onSessionExpired = null;

export function setSessionExpiredCallback(cb) {
  _onSessionExpired = cb;
}

// Deduplicate concurrent refresh calls to avoid token rotation race conditions
let _refreshPromise = null;

async function refreshTokens() {
  const auth = getAuth();
  if (!auth?.refreshToken) return null;

  const res = await fetch(API + '/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });

  if (res.ok) {
    const data = await res.json();
    auth.accessToken = data.accessToken;
    auth.refreshToken = data.refreshToken;
    setAuthStorage(auth);
    return auth;
  }
  return null;
}

async function doRefresh() {
  if (!_refreshPromise) {
    _refreshPromise = refreshTokens().finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

export async function api(method, path, body) {
  showLoading();
  try {
    const auth = getAuth();
    const headers = { 'Content-Type': 'application/json' };
    if (auth?.accessToken) headers.Authorization = 'Bearer ' + auth.accessToken;

    let res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && getAuth()?.refreshToken) {
      const refreshed = await doRefresh();
      if (refreshed) {
        headers.Authorization = 'Bearer ' + refreshed.accessToken;
        res = await fetch(API + path, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } else {
        clearAuthStorage();
        if (_onSessionExpired) _onSessionExpired();
        return { _error: 'Session expired' };
      }
    }

    const json = await res.json();
    if (!res.ok) json._error = json.error || 'Request failed';
    return json;
  } finally {
    hideLoading();
  }
}

export async function fetchAffiliations() {
  try {
    const res = await fetch(API + '/v1/affiliations');
    const data = await res.json();
    return data.affiliations || [];
  } catch {
    return [];
  }
}

export { API };
