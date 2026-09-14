import { Context, EggAppConfig, EggAppInfo, PowerPartial } from 'egg';
import * as dotenv from 'dotenv';
import {
  ApprovalTimeoutEnvironment,
  EventObservabilityEnvironment,
  EventWorkerEnvironment,
  LeadRecycleEnvironment,
  loadEnvironment,
} from './env';
import { resolveCorsOrigin } from './cors';
import { resolveRunDirectory, resolveStaticDirectory } from './static-path';

// 加载环境变量
dotenv.config();
const env = loadEnvironment(process.env);

export type DefaultConfig = PowerPartial<EggAppConfig>;
type JwtConfig = { secret: string };
type IdentitySecurityConfig = {
  mfaEncryptionKeys: ReadonlyMap<number, Buffer>;
  trustedOrigins: string[];
  production: boolean;
  localPasswordLogin: boolean;
};
type ConfigWithJwt = DefaultConfig & {
  jwt: JwtConfig;
  identitySecurity: IdentitySecurityConfig;
  eventWorker: EventWorkerEnvironment;
  eventObservability: EventObservabilityEnvironment;
  leadRecycle: LeadRecycleEnvironment;
  approvalTimeout: ApprovalTimeoutEnvironment;
};

export default (appInfo: EggAppInfo) => {
  const config = {} as ConfigWithJwt;

  // 应用密钥
  config.keys = env.appKeys.join(',');

  // 中间件配置
  config.middleware = ['errorHandler', 'csrf', 'auth', 'authorizationContext', 'administratorMfaGuard'];

  // 安全配置
  config.security = {
    csrf: {
      enable: false,
    },
  };

  // CORS 配置
  config.cors = {
    origin: (ctx: Context) => resolveCorsOrigin(ctx.get('origin'), env.corsAllowedOrigins),
    allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
    credentials: true,
  };

  // JWT 配置
  config.jwt = {
    secret: env.jwtSecret,
  };

  config.identitySecurity = {
    mfaEncryptionKeys: env.mfaEncryptionKeys,
    trustedOrigins: env.trustedOrigins,
    production: env.production,
    localPasswordLogin: env.localPasswordLogin,
  };

  config.eventWorker = env.eventWorker;
  config.eventObservability = env.eventObservability;
  config.leadRecycle = env.leadRecycle;
  config.approvalTimeout = env.approvalTimeout;

  // 日志配置
  config.logger = {
    level: 'INFO',
    consoleLevel: 'INFO',
  };

  config.rundir = resolveRunDirectory(appInfo.baseDir);

  config.multipart = { mode: 'stream', fileSize: '10mb', files: 1, whitelist: ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.xlsx', '.docx'] };

  // bodyParser 配置
  config.bodyParser = {
    jsonLimit: '16mb', // Case intake: up to 10MB decoded attachments plus base64 overhead.
    formLimit: '1mb',
  };

  // 静态文件服务配置（前端 SPA build 输出）
  config.static = {
    prefix: '/',
    dir: resolveStaticDirectory(appInfo.baseDir),
    maxAge: 0, // 开发时不缓存，生产可设 31536000
    dynamic: true,
    preload: false,
    buffer: false,
  };

  return config;
};
