import { createHash, randomBytes } from 'node:crypto';

const MINIMUM_TOKEN_BYTES = 32;

export function createOpaqueToken(bytes = MINIMUM_TOKEN_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < MINIMUM_TOKEN_BYTES) {
    throw new Error('OPAQUE_TOKEN_SIZE_INVALID');
  }
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
