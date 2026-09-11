import * as jwt from 'jsonwebtoken';
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
  constructor(private readonly secret: string) {}

  signSessionAccess(
    userId: string,
    sessionId: string,
    credentialVersion: number,
    assuranceLevel: AssuranceLevel,
  ): string {
    return jwt.sign(
      { userId, sessionId, credentialVersion, assuranceLevel, tokenType: 'access' },
      this.secret,
      { algorithm: JWT_ALGORITHM, expiresIn: '15m' },
    );
  }

  verifySessionAccess(token: string): SessionAccessClaims {
    try {
      const claims = jwt.verify(token, this.secret, { algorithms: [JWT_ALGORITHM] });
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
