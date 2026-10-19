import { Context } from 'egg';
import { BcryptPasswordHasher } from '../../domain/security/password-hasher';
import { JwtTokenService } from '../../domain/security/token-service';
import { MfaSecretCrypto } from '../../domain/security/mfa-factor-crypto';
import { TotpService } from '../../domain/security/totp-service';
import { AuthChallengeService } from './auth-challenge-service';
import { AuthenticationService } from './authentication-service';
import { MfaService } from './mfa-service';
import { SessionService } from './session-service';
import { StepUpService } from './step-up-service';

interface AuthConfig {
  jwt: { secret: string };
  identitySecurity: {
    mfaEncryptionKeys: ReadonlyMap<number, Buffer>;
    trustedOrigins: string[];
    production: boolean;
    localPasswordLogin?: boolean;
  };
}

export interface AuthenticationServices {
  authentication: AuthenticationService;
  challenges: AuthChallengeService;
  mfa: MfaService;
  sessions: SessionService;
  stepUp: StepUpService;
}

export function createAuthenticationServices(ctx: Context): AuthenticationServices {
  const config = ctx.app.config as typeof ctx.app.config & AuthConfig;
  const hasher = new BcryptPasswordHasher();
  const tokens = new JwtTokenService(config.jwt.secret);
  const challenges = new AuthChallengeService(ctx.prisma);
  const totp = new TotpService();
  const secretCrypto = new MfaSecretCrypto(config.identitySecurity.mfaEncryptionKeys);
  const stepUp = new StepUpService(ctx.prisma, totp, secretCrypto);
  const sessions = new SessionService(ctx.prisma, tokens, undefined, undefined, stepUp);
  const mfa = new MfaService(
    ctx.prisma,
    challenges,
    totp,
    secretCrypto,
    hasher,
    stepUp,
    undefined,
    undefined,
    config.identitySecurity.localPasswordLogin === true,
  );
  return {
    authentication: new AuthenticationService(
      ctx.prisma, hasher, challenges, mfa, sessions, undefined, undefined,
      config.identitySecurity.localPasswordLogin === true,
    ),
    challenges,
    mfa,
    sessions,
    stepUp,
  };
}

export function createAuthenticationService(ctx: Context): AuthenticationService {
  return createAuthenticationServices(ctx).authentication;
}
