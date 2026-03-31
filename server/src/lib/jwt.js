import { SignJWT, jwtVerify } from 'jose';
import { JWT_SECRET, ACCESS_TOKEN_EXPIRY } from '../config.js';

function getSecretKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

export async function signAccessToken(userId, role) {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getSecretKey());
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload;
}
