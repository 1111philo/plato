// How an account signs in (single sign-on, docs/SSO.md), for Admin → Users:
// the Sign-in column, filter, CSV column, and the Edit User block. Pure;
// tested in client/tests/signIn.test.js.
//
// `user` is a GET /v1/admin/users row: `sso: { provider, email, linkedAt } | null`
// and `hasPassword`. `providers` is GET /v1/auth/sso/providers' list,
// `[{ id, label }]`, where `label` is the sign-in button's text.

/** A provider's short name: "Sign in with UIC" → "UIC". Unknown or switched-off provider → "SSO". */
export function providerName(providerId, providers = []) {
  const label = providers.find((p) => p.id === providerId)?.label;
  if (typeof label !== 'string' || !label.trim()) return 'SSO';
  return label.trim().replace(/^(sign|log)\s*in\s+with\b\s*/i, '').trim() || 'SSO';
}

/** The ways a signed-up user can sign in, as labels: `['Password', 'UIC']`. */
export function signInMethods(user, providers = []) {
  if (!user) return [];
  const methods = [];
  // Rows from a server without SSO have no `hasPassword`; every such account has a password.
  if (user.hasPassword !== false) methods.push('Password');
  if (user.sso) methods.push(providerName(user.sso.provider, providers));
  return methods;
}

/** Whether to show the Sign-in column and filter: a provider is on, or someone is linked. */
export const ssoInPlay = (users = [], providers = []) => providers.length > 0 || users.some((u) => !!u.sso);
