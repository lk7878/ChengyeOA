import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import mm from 'egg-mock';
import { selectTestDatabaseUrl } from '../../config/config.unittest';

// Only serve requests here. The parent owns isolated test data and the load clients.
async function main() {
  selectTestDatabaseUrl();
  process.env.EGG_TYPESCRIPT = 'true';
  const app = mm.app();
  await app.ready();
  const db = app.createAnonymousContext().prisma;
  const timings: Record<string, number[]> = {};
  const errors: Record<string, number> = {};
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  db.$use(async (params, next) => {
    const start = performance.now();
    try {
      return await next(params);
    } catch (error) {
      const code = /^P[0-9]{4}$/.test((error as { code?: string }).code || '')
        ? (error as { code: string }).code
        : 'unknown';
      errors[code] = (errors[code] || 0) + 1;
      throw error;
    } finally {
      const operation = (params.model || 'raw') + '.' + params.action;
      (timings[operation] ||= []).push(performance.now() - start);
    }
  });
  const server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    loop.disable();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
    await db.$disconnect();
    await mm.restore();
    process.exit(0);
  };
  process.on('message', (message: { type: string }) => {
    if (message.type === 'stop') void stop();
    if (message.type === 'metrics') {
      const summaries = Object.fromEntries(
        Object.entries(timings).map(([key, values]) => {
          const sorted = [...values].sort((a, b) => a - b);
          return [
            key,
            {
              count: sorted.length,
              p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
              p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
              max: sorted.at(-1),
            },
          ];
        }),
      );
      process.send?.({
        type: 'metrics',
        databaseTimings: summaries,
        databaseErrors: errors,
        eventLoopMs: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 },
      });
    }
  });
  process.on('disconnect', () => {
    void stop();
  });
  process.send?.({
    type: 'ready',
    origin: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
    trustedOrigin: app.config.identitySecurity.trustedOrigins[0],
  });
}
void main().catch((error) => {
  console.error('Load server failed:', (error as Error).name);
  process.exit(1);
});
