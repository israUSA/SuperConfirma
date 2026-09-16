import { createHash, randomBytes } from 'node:crypto';

// P11: access without an account. Only the hash is stored, so a database leak grants nothing.
export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
