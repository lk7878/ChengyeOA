import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { SessionAccessClaims } from '../../domain/security/token-service';
import { SecurityError } from '../../domain/security/security-errors';
import { assertExactKeys } from '../../domain/master-data/master-data-validation';

export type HarnessFeature = 'knowledge' | 'smart-case';
const AUDIENCE = 'chengye-local-harness-v1';
const permission = (feature: HarnessFeature) => feature === 'knowledge' ? 'menu.knowledge' as const : 'menu.smart_case' as const;
function validFeature(value: unknown): asserts value is HarnessFeature {
  if (value !== 'knowledge' && value !== 'smart-case') throw new SecurityError('HARNESS_TICKET_INVALID', 400);
}
export class HarnessTicketService {
  constructor(private db: PrismaClient, private secret: string) {}
  issue(input: unknown, user: SessionAccessClaims, context: AuthorizationContext) {
    assertExactKeys(input, ['feature', 'challenge']); validFeature(input.feature);
    if (typeof input.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(input.challenge)) throw new SecurityError('HARNESS_TICKET_INVALID', 400);
    new AuthorizationService().requireAction(context, permission(input.feature));
    const ticket = jwt.sign({ tokenType: 'harness-launch', userId: user.userId, sessionId: user.sessionId, credentialVersion: user.credentialVersion, feature: input.feature, challenge: input.challenge }, this.secret, { algorithm: 'HS256', audience: AUDIENCE, expiresIn: 60 });
    return { ticket, expiresIn: 60 };
  }
  async verify(input: unknown) {
    assertExactKeys(input, ['ticket', 'challenge', 'feature']); validFeature(input.feature);
    if (typeof input.ticket !== 'string' || input.ticket.length > 4096 || typeof input.challenge !== 'string') throw new SecurityError('HARNESS_TICKET_INVALID', 401);
    let claims: jwt.JwtPayload;
    try {
      const result = jwt.verify(input.ticket, this.secret, { algorithms: ['HS256'], audience: AUDIENCE, maxAge: '60s' });
      if (typeof result !== 'object' || result.tokenType !== 'harness-launch' || result.challenge !== input.challenge || result.feature !== input.feature || typeof result.userId !== 'string' || typeof result.sessionId !== 'string' || !Number.isInteger(result.credentialVersion)) throw new Error('Invalid claims');
      claims = result;
    } catch { throw new SecurityError('HARNESS_TICKET_INVALID', 401); }
    const session = await this.db.authSession.findUnique({ where: { id: claims.sessionId }, select: { userId: true, credentialVersion: true, revokedAt: true, expiresAt: true, user: { select: { credentialVersion: true, mustChangePassword: true } } } });
    if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= new Date() || session.credentialVersion !== claims.credentialVersion || session.user.credentialVersion !== claims.credentialVersion || session.user.mustChangePassword) throw new SecurityError('HARNESS_TICKET_INVALID', 401);
    const context = await new AuthorizationContextLoader(this.db).load(claims.userId);
    new AuthorizationService().requireAction(context, permission(input.feature));
    return { protocol: 1, userId: claims.userId, feature: input.feature, challenge: input.challenge };
  }
}
