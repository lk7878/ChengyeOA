import { SecurityError } from './security-errors';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): void {
  if (!USERNAME_PATTERN.test(normalizeUsername(value))) {
    throw new SecurityError('USERNAME_INVALID');
  }
}

export function validateTemporaryPassword(value: string): void {
  if (value.length < 6 || value.length > 128 || value !== value.trim() || containsControlCharacter(value)) {
    throw new SecurityError('PASSWORD_INVALID');
  }
}

export function validatePassword(value: string, _username: string): void {
  validateTemporaryPassword(value);
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
