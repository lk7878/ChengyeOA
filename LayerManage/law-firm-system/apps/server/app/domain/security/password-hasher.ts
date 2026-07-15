import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

const HASH_MARKER = 'chengye$bcrypt-sha256$v1$';
const HASH_NAMESPACE = 'chengye$';
const RAW_BCRYPT_HASH = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export interface PasswordHasher {
  hash(value: string): Promise<string>;
  compare(value: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 12) {}

  async hash(value: string): Promise<string> {
    const hash = await bcrypt.hash(preHash(value), this.rounds);
    return `${HASH_MARKER}${hash}`;
  }

  async compare(value: string, stored: string): Promise<boolean> {
    try {
      if (stored.startsWith(HASH_MARKER)) {
        const hash = stored.slice(HASH_MARKER.length);
        return RAW_BCRYPT_HASH.test(hash) && await bcrypt.compare(preHash(value), hash);
      }
      if (stored.startsWith(HASH_NAMESPACE) || !RAW_BCRYPT_HASH.test(stored)) {
        return false;
      }
      return await bcrypt.compare(value, stored);
    } catch {
      return false;
    }
  }
}

function preHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
