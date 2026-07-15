import { SecurityError } from './security-errors';
import { WEAK_PASSWORDS } from './weak-passwords';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): void {
  if (!USERNAME_PATTERN.test(normalizeUsername(value))) {
    throw new SecurityError('USERNAME_INVALID');
  }
}

export function validatePassword(value: string, username: string): void {
  const categories = [
    /[A-Z]/.test(value),
    /[a-z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9\s]/.test(value),
  ].filter(Boolean).length;
  const normalizedUsername = normalizeUsername(username);

  if (
    value.length < 12
    || value.length > 128
    || categories < 3
    || value !== value.trim()
    || containsControlCharacter(value)
    || (normalizedUsername.length > 0 && value.toLowerCase().includes(normalizedUsername))
    || WEAK_PASSWORDS.has(value.toLowerCase())
  ) {
    throw new SecurityError('PASSWORD_INVALID');
  }
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
