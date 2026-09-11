import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeBase32, encodeBase32 } from './base32';

const PERIOD_SECONDS = 30;
const DIGITS = 6;

export interface TotpMatch {
  counter: bigint;
  drift: -1 | 0 | 1;
}

export class TotpService {
  generateSecret(bytes = 20): string {
    return encodeBase32(randomBytes(bytes));
  }

  buildUri(input: { issuer: string; accountName: string; secret: string }): string {
    const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
    const issuer = encodeURIComponent(input.issuer);
    return `otpauth://totp/${label}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
  }

  verify(
    secret: string,
    code: string,
    now: Date,
    lastAcceptedCounter: bigint | null = null,
  ): TotpMatch | null {
    if (!/^\d{6}$/.test(code)) return null;
    const current = BigInt(Math.floor(now.getTime() / 1000 / PERIOD_SECONDS));
    for (const drift of [0, -1, 1] as const) {
      const counter = current + BigInt(drift);
      if (counter < 0n || (lastAcceptedCounter !== null && counter <= lastAcceptedCounter)) continue;
      const expected = this.codeAt(secret, counter);
      if (timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return { counter, drift };
    }
    return null;
  }

  private codeAt(secret: string, counter: bigint): string {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(counter);
    const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** DIGITS);
    return binary.toString().padStart(DIGITS, '0');
  }
}
