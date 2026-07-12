import { EggPlugin } from 'egg';

const plugin: EggPlugin = {
  // CORS 跨域
  cors: {
    enable: true,
    package: 'egg-cors',
  },
  // JWT 认证
  jwt: {
    enable: true,
    package: 'egg-jwt',
  },
};

export default plugin;
