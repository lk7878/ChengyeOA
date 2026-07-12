import { Application } from 'egg';

class AppBootHook {
  private readonly app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  async didReady() {
    // 应用已启动完成
    this.app.logger.info('App started, JWT_SECRET loaded from .env');
  }
}

export default AppBootHook;
