import { Context } from 'egg';
import { BcryptPasswordHasher } from '../../domain/security/password-hasher';
import { JwtTokenService } from '../../domain/security/token-service';
import { AuthenticationService } from './authentication-service';

interface AuthConfig {
  jwt: { secret: string };
}

export function createAuthenticationService(ctx: Context): AuthenticationService {
  const config = ctx.app.config as typeof ctx.app.config & AuthConfig;
  return new AuthenticationService(
    ctx.prisma,
    new BcryptPasswordHasher(),
    new JwtTokenService(config.jwt.secret),
  );
}
