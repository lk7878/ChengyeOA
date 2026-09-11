import { Context } from 'egg';
import { AuthorizationContextLoader } from './authorization-context-loader';
import { AuthorizationService } from './authorization-service';

export function createAuthorizationContextLoader(ctx: Context): AuthorizationContextLoader {
  return new AuthorizationContextLoader(ctx.prisma);
}

export function createAuthorizationService(): AuthorizationService {
  return new AuthorizationService();
}
