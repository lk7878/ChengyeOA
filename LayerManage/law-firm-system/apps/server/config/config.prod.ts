import { EggAppConfig, PowerPartial } from 'egg';

export type DefaultConfig = PowerPartial<EggAppConfig>;

export default () => {
  const config = {} as DefaultConfig;

  // 生产环境配置
  config.logger = {
    level: 'WARN',
    consoleLevel: 'WARN',
  };

  return config;
};
