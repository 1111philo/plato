import { SignJWT, jwtVerify } from 'jose';
import { JWT_SECRET, ACCESS_TOKEN_EXPIRY } from '../config.js';

function getSecretKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

// `tv`: the user's session version (lib/sessions.js); authenticate refuses a
// token whose `tv` no longer matches. Tokens without it read as version 0.
export async function signAccessToken(userId, role, { tokenVersion = 0 } = {}) {
  return new SignJWT({ sub: userId, role, tv: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getSecretKey());
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload;
}
