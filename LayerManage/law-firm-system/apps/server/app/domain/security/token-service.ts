import * as jwt from 'jsonwebtoken';
import { SecurityError } from './security-errors';

export type TokenType = 'access' | 'refresh' | 'password_change';

export interface AuthTokenClaims extends jwt.JwtPayload {
  userId: string;
  tokenType: TokenType;
  credentialVersion: number;
}

const TOKEN_TYPES: ReadonlySet<TokenType> = new Set(['access', 'refresh', 'password_change']);

export class JwtTokenService {
  constructor(private readonly secret: string) {}

  signAccess(userId: string, credentialVersion: number): string {
    return this.sign(userId, credentialVersion, 'access', '7d');
  }

  signRefresh(userId: string, credentialVersion: number): string {
    return this.sign(userId, credentialVersion, 'refresh', '30d');
  }

  signPasswordChange(userId: string, credentialVersion: number): string {
    return this.sign(userId, credentialVersion, 'password_change', '5m');
  }

  verify(token: string, allowedTypes: readonly TokenType[]): AuthTokenClaims {
    try {
      const claims = jwt.verify(token, this.secret);
      if (!this.hasRequiredClaims(claims)) {
        throw new SecurityError('TOKEN_INVALID', 401);
      }
      if (!allowedTypes.includes(claims.tokenType)) {
        throw new SecurityError('TOKEN_TYPE_INVALID', 401);
      }
      return claims;
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw new SecurityError('TOKEN_INVALID', 401);
    }
  }

  private sign(
    userId: string,
    credentialVersion: number,
    tokenType: TokenType,
    expiresIn: jwt.SignOptions['expiresIn'],
  ): string {
    return jwt.sign({ userId, credentialVersion, tokenType }, this.secret, { expiresIn });
  }

  private hasRequiredClaims(claims: string | jwt.JwtPayload): claims is AuthTokenClaims {
    return typeof claims === 'object'
      && typeof claims.userId === 'string'
      && TOKEN_TYPES.has(claims.tokenType as TokenType)
      && typeof claims.credentialVersion === 'number';
  }
}
