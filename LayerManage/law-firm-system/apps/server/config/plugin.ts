import { EggPlugin } from 'egg';

const plugin: EggPlugin = {
  // CORS 跨域
  cors: {
    enable: true,
    package: 'egg-cors',
  },
};

export default plugin;
