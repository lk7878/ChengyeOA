import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ACTIVE_KEY_VERSION = 1;

export interface EncryptedMfaSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export class MfaSecretCrypto {
  constructor(private readonly keys: ReadonlyMap<number, Buffer>) {
    for (const key of keys.values()) {
      if (key.length !== 32) throw new Error('MFA_KEY_INVALID');
    }
    if (!keys.has(ACTIVE_KEY_VERSION)) throw new Error('MFA_KEY_INVALID');
  }

  encrypt(secret: string): EncryptedMfaSecret {
    const key = this.keys.get(ACTIVE_KEY_VERSION)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
      keyVersion: ACTIVE_KEY_VERSION,
    };
  }

  decrypt(value: EncryptedMfaSecret): string {
    try {
      const key = this.keys.get(value.keyVersion);
      if (!key) invalid();
      const iv = Buffer.from(value.iv, 'base64url');
      const authTag = Buffer.from(value.authTag, 'base64url');
      const ciphertext = Buffer.from(value.ciphertext, 'base64url');
      if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) invalid();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      invalid();
    }
  }
}

function invalid(): never {
  throw new Error('MFA_SECRET_INVALID');
}
