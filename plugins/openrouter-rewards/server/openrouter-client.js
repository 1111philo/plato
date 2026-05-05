const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

function headers(managementKey, extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(managementKey ? { Authorization: `Bearer ${managementKey}` } : {}),
    ...extra,
  };
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.error || data?.message || `OpenRouter request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export function createOpenRouterClient({ managementKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  const request = async (path, options = {}) => {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: headers(managementKey, options.headers),
    });
    return readJson(res);
  };

  return {
    async exchangeOAuthCode({ code, codeVerifier }) {
      const json = await request('/auth/keys', {
        method: 'POST',
        body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
      });
      return { plaintext: json.key, openrouterUserId: json.user_id || json.userId || json.data?.user_id };
    },

    async addWorkspaceMember(workspaceId, userId) {
      return request(`/workspaces/${encodeURIComponent(workspaceId)}/members/add`, {
        method: 'POST',
        body: JSON.stringify({ user_ids: [userId] }),
      });
    },

    async createKey(body) {
      const json = await request('/keys', { method: 'POST', body: JSON.stringify(body) });
      const data = json.data || json;
      return { ...data, plaintext: json.key, hash: data.hash || json.hash };
    },

    async getKey(hash) {
      const json = await request(`/keys/${encodeURIComponent(hash)}`);
      return json.data || json;
    },

    async patchKey(hash, body) {
      const json = await request(`/keys/${encodeURIComponent(hash)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      return json.data || json;
    },

    async disableKey(hash) {
      return request(`/keys/${encodeURIComponent(hash)}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: true }),
      });
    },

    async deleteKey(hash) {
      return request(`/keys/${encodeURIComponent(hash)}`, { method: 'DELETE' });
    },

    async listKeys() {
      const json = await request('/keys');
      return json.data || json;
    },

    async listWorkspaces() {
      const json = await request('/workspaces');
      return json.data || json;
    },
  };
}
