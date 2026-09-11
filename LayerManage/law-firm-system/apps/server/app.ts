import type { PrismaClient } from '@prisma/client';
import { Application } from 'egg';

import {
  createEventServices,
  type EventServices,
  type EventServicesFactoryOptions,
} from './app/application/events/event-services-factory';
import type { EventWorker } from './app/application/events/event-worker';
import type { EventWorkerEnvironment } from './config/env';

export interface AppBootHookDependencies {
  createEventServices(
    prisma: PrismaClient,
    config: EventWorkerEnvironment,
    options?: EventServicesFactoryOptions,
  ): Pick<EventServices, 'worker' | 'runtimeStatus'>;
}

const productionDependencies: AppBootHookDependencies = { createEventServices };

class AppBootHook {
  private readonly app: Application;
  private readonly dependencies: AppBootHookDependencies;
  private eventWorker: EventWorker | null = null;
  private eventRuntimeStatus: Pick<EventServices['runtimeStatus'], 'markStopped'> | null = null;
  private initialized = false;

  constructor(app: Application, dependencies: AppBootHookDependencies = productionDependencies) {
    this.app = app;
    this.dependencies = dependencies;
  }

  async didReady(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const config = this.app.config.eventWorker;
    const prisma = this.app.createAnonymousContext().prisma;
    const services = this.dependencies.createEventServices(prisma, config, {
      observability: this.app.config.eventObservability,
      leadRecycle: this.app.config.leadRecycle,
      // SPEC-021 Task 2：审批超时扫描器随事件 worker tick 节律运行（沿 leadRecycle 注入点）。
      approvalTimeout: this.app.config.approvalTimeout,
    });
    try {
      if (config.enabled) await services.runtimeStatus.markStarting();
      else await services.runtimeStatus.markDisabled();
    } catch {
      this.app.logger.error('Event worker runtime status could not be initialized safely.');
      throw new Error('Event worker runtime status could not be initialized safely.');
    }
    if (!config.enabled) {
      this.app.logger.info('Event worker disabled.');
      return;
    }

    this.eventWorker = services.worker;
    this.eventRuntimeStatus = services.runtimeStatus;
    this.eventWorker.start();
    this.app.logger.info('Event worker enabled.');
  }

  async beforeClose(): Promise<void> {
    const worker = this.eventWorker;
    if (!worker) return;
    const runtimeStatus = this.eventRuntimeStatus;
    this.eventWorker = null;
    this.eventRuntimeStatus = null;
    try {
      await worker.stop(this.app.config.eventWorker.shutdownSeconds * 1000);
    } catch {
      this.app.logger.error('Event worker shutdown did not complete safely.');
      return;
    }
    try {
      await runtimeStatus?.markStopped();
    } catch {
      this.app.logger.error('Event worker stopped status could not be recorded safely.');
    }
  }
}

export default AppBootHook;
