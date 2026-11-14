const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(input: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let encoded = '';

  for (const byte of input) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }

  if (bits > 0) encoded += ALPHABET[(buffer << (5 - bits)) & 31];
  return encoded;
}

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase();
  if (!/^[A-Z2-7]*={0,6}$/.test(normalized)) invalid();
  const firstPadding = normalized.indexOf('=');
  if (firstPadding >= 0 && normalized.length % 8 !== 0) invalid();
  const value = firstPadding >= 0 ? normalized.slice(0, firstPadding) : normalized;

  let buffer = 0;
  let bits = 0;
  const decoded: number[] = [];
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) invalid();
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }

  if (bits > 0 && buffer !== 0) invalid();
  return Buffer.from(decoded);
}

function invalid(): never {
  throw new Error('BASE32_INVALID');
}
