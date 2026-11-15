import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { SessionAccessClaims } from '../../domain/security/token-service';
import { SecurityError } from '../../domain/security/security-errors';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class SmartCaseIdentity {
  constructor(private db: PrismaClient) {}
  async issue(user: SessionAccessClaims, context: AuthorizationContext, challenge: string) {
    new AuthorizationService().requireAction(context, 'menu.smart_case');
    const base = process.env.SMART_CASE_PUBLIC_URL;
    if (!base || !process.env.SMART_CASE_CLIENT_SECRET) throw new SecurityError('SMART_CASE_NOT_CONFIGURED', 503);
    if(!/^[a-f0-9]{64}$/.test(challenge))throw new SecurityError('TOKEN_INVALID',400);
    const code = randomBytes(32).toString('base64url');
    await this.db.smartCaseCode.create({ data: { hash: digest(code), challenge, userId: user.userId, sessionId: user.sessionId, credentialVersion: user.credentialVersion, assuranceLevel: user.assuranceLevel, expiresAt: new Date(Date.now()+60000) } });
    const url = new URL('/api/auth/oa/callback', base); url.searchParams.set('code', code);
    return { url: url.href };
  }
  async exchange(code: string, clientSecret: string, verifier: string) {
    const expected = process.env.SMART_CASE_CLIENT_SECRET || '';
    if (!expected || expected.length < 32 || !clientSecret || !timingSafeEqual(Buffer.from(digest(expected)), Buffer.from(digest(clientSecret)))) throw new SecurityError('TOKEN_INVALID', 401);
    return this.db.$transaction(async tx => {
      const hash = digest(code);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash},0))`;
      const row = await tx.smartCaseCode.findUnique({ where: { hash } });
      if (!row || row.expiresAt <= new Date() || digest(verifier) !== row.challenge) throw new SecurityError('TOKEN_INVALID', 401);
      const token = 'sc_' + randomBytes(32).toString('base64url');
      const sessionRow = { userId: row.userId, sessionId: row.sessionId, credentialVersion: row.credentialVersion, assuranceLevel: row.assuranceLevel };
      await tx.smartCaseSession.create({ data: { ...sessionRow, hash: digest(token), expiresAt: new Date(Date.now()+8*3600000) } });
      await tx.smartCaseCode.delete({ where: { hash } });
      return { token, expiresIn: 28800 };

    });
  }
  async authenticate(token: string): Promise<SessionAccessClaims> {
    const row = await this.db.smartCaseSession.findUnique({ where: { hash: digest(token) } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new SecurityError('TOKEN_INVALID', 401);
    const session = await this.db.authSession.findUnique({ where: { id: row.sessionId }, include: { user: true } });
    if (!session || session.userId !== row.userId || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ENABLED' || session.user.mustChangePassword || session.user.credentialVersion !== row.credentialVersion || session.credentialVersion !== row.credentialVersion) throw new SecurityError('TOKEN_INVALID', 401);
    const context = await new AuthorizationContextLoader(this.db).load(row.userId);
    new AuthorizationService().requireAction(context, 'menu.smart_case');
    return { userId: row.userId, sessionId: row.sessionId, credentialVersion: row.credentialVersion, assuranceLevel: row.assuranceLevel === 'MFA' ? 'MFA' : 'PASSWORD', tokenType: 'access' };
  }
  async revoke(token: string) { await this.db.smartCaseSession.updateMany({ where: { hash: digest(token) }, data: { revokedAt: new Date() } }); }
}
