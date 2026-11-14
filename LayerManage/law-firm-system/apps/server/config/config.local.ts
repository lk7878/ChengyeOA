import { EggAppConfig, PowerPartial } from 'egg';

export type DefaultConfig = PowerPartial<EggAppConfig>;

export default () => {
  const config = {} as DefaultConfig;

  config.cluster = {
    listen: {
      port: 7001,
      hostname: '127.0.0.1',
    },
  };

  // 开发环境配置
  config.logger = {
    level: 'DEBUG',
    consoleLevel: 'DEBUG',
  };

  return config;
};
