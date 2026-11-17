import * as jwt from 'jsonwebtoken';
import { createSecretKey, KeyObject } from 'node:crypto';
import { SecurityError } from './security-errors';

export type AssuranceLevel = 'PASSWORD' | 'MFA';

export interface SessionAccessClaims extends jwt.JwtPayload {
  userId: string;
  sessionId: string;
  credentialVersion: number;
  assuranceLevel: AssuranceLevel;
  tokenType: 'access';
}

const JWT_ALGORITHM = 'HS256';

export class JwtTokenService {
  private readonly key: KeyObject;

  constructor(secret: string) {
    this.key = createSecretKey(Buffer.from(secret, 'utf8'));
  }

  signSessionAccess(
    userId: string,
    sessionId: string,
    credentialVersion: number,
    assuranceLevel: AssuranceLevel,
  ): string {
    return jwt.sign(
      { userId, sessionId, credentialVersion, assuranceLevel, tokenType: 'access' },
      this.key,
      { algorithm: JWT_ALGORITHM, expiresIn: '15m' },
    );
  }

  verifySessionAccess(token: string): SessionAccessClaims {
    return this.verifyClaims(token, false);
  }

  // Signature/type validation still applies. Expiry is ignored solely for
  // revoking the session identified by this credential, never for granting access.
  verifyLogoutAccess(token: string): SessionAccessClaims {
    return this.verifyClaims(token, true);
  }

  private verifyClaims(token: string, ignoreExpiration: boolean): SessionAccessClaims {
    try {
      const claims = jwt.verify(token, this.key, { algorithms: [JWT_ALGORITHM], ignoreExpiration });
      if (
        typeof claims !== 'object'
        || claims.tokenType !== 'access'
        || typeof claims.userId !== 'string'
        || typeof claims.sessionId !== 'string'
        || typeof claims.credentialVersion !== 'number'
        || !Number.isFinite(claims.credentialVersion)
        || (claims.assuranceLevel !== 'PASSWORD' && claims.assuranceLevel !== 'MFA')
        || typeof claims.exp !== 'number'
        || !Number.isFinite(claims.exp)
      ) {
        throw invalidToken();
      }
      return claims as SessionAccessClaims;
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      throw invalidToken();
    }
  }
}

function invalidToken(): SecurityError {
  return new SecurityError('TOKEN_INVALID', 401);
}
