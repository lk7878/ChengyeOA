import * as bcrypt from 'bcryptjs';

export interface PasswordHasher {
  hash(value: string): Promise<string>;
  compare(value: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds = 12) {}

  hash(value: string): Promise<string> {
    return bcrypt.hash(value, this.rounds);
  }

  compare(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash);
  }
}
