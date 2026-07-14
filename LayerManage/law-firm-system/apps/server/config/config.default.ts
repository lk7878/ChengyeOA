import { EggAppConfig, EggAppInfo, PowerPartial } from 'egg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadEnvironment } from './env';

// 加载环境变量
dotenv.config();
const env = loadEnvironment(process.env);

export type DefaultConfig = PowerPartial<EggAppConfig>;
type JwtConfig = { secret: string; expiresIn: string };
type ConfigWithJwt = DefaultConfig & { jwt: JwtConfig };

export default (appInfo: EggAppInfo) => {
  const config = {} as ConfigWithJwt;

  // 应用密钥
  config.keys = env.appKeys.join(',');

  // 中间件配置
  config.middleware = ['errorHandler', 'auth'];

  // 安全配置
  config.security = {
    csrf: {
      enable: false,
    },
  };

  // CORS 配置
  config.cors = {
    origin: '*',
    allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
    credentials: true,
  };

  // JWT 配置
  config.jwt = {
    secret: env.jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  };

  // 日志配置
  config.logger = {
    level: 'INFO',
    consoleLevel: 'INFO',
  };

  // bodyParser 配置
  config.bodyParser = {
    jsonLimit: '1mb',
    formLimit: '1mb',
  };

  // 静态文件服务配置（前端 SPA build 输出）
  config.static = {
    prefix: '/',
    dir: path.join(appInfo.baseDir, 'public'),
    maxAge: 0, // 开发时不缓存，生产可设 31536000
    dynamic: true,
    preload: false,
    buffer: false,
  };

  return config;
};
