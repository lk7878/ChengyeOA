import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'node:path';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

const enabled = process.env.COLLAB_LOAD_REHEARSAL === 'true';
const seconds = Number(process.env.COLLAB_LOAD_SECONDS || 900);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Row = { id: string; version: number; createdBy: string; values: Record<string, unknown> };
type Client = {
  id: string;
  token: string;
  refreshToken: string;
  csrfToken: string;
  profile: number;
  abort?: AbortController;
  reading?: Promise<void>;
  pending: boolean;
  stopped: boolean;
  ready: boolean;
  reconnectAt?: number;
  revokedAt?: number;
};
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    max: sorted.at(-1) ?? null,
  };
};

test(
  '100 authenticated sessions sustain the P1 workload and permission boundaries',
  {
    skip: !enabled,
    timeout: (seconds + 240) * 1000,
  },
  async () => {
    assert.ok(seconds >= 10 && seconds <= 1800, 'duration must be 10..1800 seconds');
    process.env.EGG_TYPESCRIPT = 'true';
    const db = createTestPrisma();
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
    await mkdir(evidence, { recursive: true });
    await writeFile(
      path.join(evidence, 'load-report.json'),
      JSON.stringify({ status: 'running', stage: 'starting', requestedSeconds: seconds }),
    );
    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    const server = fork(path.resolve('test/helpers/collaboration-load-server.ts'), [], {
      execArgv: [
        '--import',
        'tsx',
        ...(process.env.COLLAB_LOAD_CPU_PROFILE === 'true'
          ? ['--cpu-prof', '--cpu-prof-dir=' + path.resolve('../../var/collaboration-evidence')]
          : []),
      ],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    server.stdout?.pipe(process.stdout);
    server.stderr?.pipe(process.stderr);
    const receive = (type: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Load server IPC timeout: ' + type));
        }, 30000);
        const onMessage = (message: Record<string, unknown>) => {
          if (message.type === type) {
            cleanup();
            resolve(message);
          }
        };
        const onExit = () => {
          cleanup();
          reject(new Error('Load server exited before ' + type));
        };
        const onError = () => {
          cleanup();
          reject(new Error('Load server process error before ' + type));
        };
        const cleanup = () => {
          clearTimeout(timer);
          server.off('message', onMessage);
          server.off('exit', onExit);
          server.off('error', onError);
        };
        server.on('message', onMessage);
        server.once('exit', onExit);
        server.once('error', onError);
      });
    const ready = await receive('ready').catch(async (error) => {
      loop.disable();
      server.kill();
      await db.$disconnect();
      await writeFile(
        path.join(evidence, 'load-report.json'),
        JSON.stringify(
          {
            status: 'aborted',
            stage: 'starting',
            requestedSeconds: seconds,
            measuredSeconds: 0,
            fullDuration: false,
            reason: (error as Error).message,
          },
          null,
          2,
        ),
      );
      throw error;
    });
    const origin = ready.origin as string;
    const serverMetrics = async () => {
      const result = receive('metrics');
      server.send({ type: 'metrics' });
      return await result;
    };
    await writeFile(
      path.join(evidence, 'load-report.json'),
      JSON.stringify({ status: 'running', requestedSeconds: seconds }),
    );
    let reportWritten = false;
    const clients: Client[] = [],
      pumps: Promise<void>[] = [];
    let workers: Promise<void>[] = [];
    const latencies: Record<string, number[]> = { query: [], save: [], visible: [], reconnect: [], rtt: [] };
    const errors: Record<string, number> = {};
    const fail = (code: string) => {
      errors[code] = (errors[code] || 0) + 1;
    };
    const observed = new Map<string, number>();
    const pending: { id: string; version: number; at: number }[] = [];
    let running = true,
      committed = 0,
      invalidations = 0,
      peakOnline = 0;
    let measuredStart = 0;
    const fieldIds = Array.from({ length: 50 }, () => randomUUID());
    const rowId = (i: number) => 'load-record-' + String(i).padStart(5, '0');
    let baseId = '',
      tableId = '';
    const request = async (client: Client, endpoint: string, body?: unknown, method = 'POST') => {
      const start = performance.now();
      const response = await fetch(origin + '/api/v1' + endpoint, {
        method,
        headers: {
          Authorization: 'Bearer ' + client.token,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json()) as {
        data?: { records: Row[]; total: number; version: number; record: Row };
        message?: string;
      };
      const elapsed = performance.now() - start;
      return { status: response.status, data: data.data, code: data.message, elapsed };
    };
    const query = (client: Client, index: number): Promise<void> => {
      if (client.reading) {
        client.pending = true;
        return client.reading;
      }
      client.reading = (async () => {
        do {
          client.pending = false;
          try {
            const config =
              index === 0
                ? {}
                : {
                    filter: { fieldId: fieldIds[2], operator: 'eq', value: 'g' + (index % 10) },
                    sorts: [{ fieldId: fieldIds[1], direction: 'asc' }],
                    groupBy: [fieldIds[2]],
                  };
            const r = await request(client, '/tables/' + tableId + '/records/query', {
              pageSize: 50,
              config,
            });
            latencies.query.push(r.elapsed);
            if (r.status !== 200 || !r.data) {
              fail('query:' + r.status + ':' + r.code);
              return;
            }
            if (r.data.records.length > 50) fail('pagination-leak');
            if (r.data.total !== (index === 0 ? 10000 : client.profile === 1 ? 100 : 1000))
              fail('count-scope');
            for (const row of r.data.records) {
              if (client.profile === 1 && row.createdBy !== client.id) fail('row-scope');
              if (client.profile === 2 && Object.hasOwn(row.values, fieldIds[49])) fail('field-scope');
              if (index === 0) observed.set(row.id, row.version);
            }
            if (index === 0) {
              for (let n = pending.length - 1; n >= 0; n--) {
                const item = pending[n];
                if ((observed.get(item.id) || 0) >= item.version) {
                  latencies.visible.push(Date.now() - item.at);
                  pending.splice(n, 1);
                }
              }
            }
          } catch {
            fail('query:transport');
          }
        } while (client.pending && running && !client.stopped);
      })().finally(() => {
        client.reading = undefined;
      });
      return client.reading;
    };
    const connect = async (client: Client, index: number) => {
      while (running && !client.stopped) {
        const abort = new AbortController();
        client.abort = abort;
        try {
          const response = await fetch(
            origin + '/api/v1/collaboration/events?baseId=' + baseId + '&tableId=' + tableId,
            {
              headers: { Authorization: 'Bearer ' + client.token },
              signal: abort.signal,
            },
          );
          if (!response.ok || !response.body) throw new Error('stream unavailable');
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = '';
          while (running && !client.stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (frame.includes('event: ready')) {
                await query(client, index);
                client.ready = true;
                if (client.reconnectAt) {
                  latencies.reconnect.push(Date.now() - client.reconnectAt);
                  client.reconnectAt = undefined;
                }
              }
              if (frame.includes('event: invalidate')) {
                invalidations++;
                void query(client, index);
              }
              if (frame.includes('event: revoked')) {
                client.revokedAt = Date.now();
                client.stopped = true;
              }
            }
          }
          reader.releaseLock();
          if (running && !client.stopped && !abort.signal.aborted) fail('stream:unexpected-close');
        } catch {
          if (running && !client.stopped && !abort.signal.aborted) fail('stream:transport');
        }
        client.ready = false;
        if (running && !client.stopped) await sleep(2000);
      }
    };
    try {
      await clearTestApplicationData(db);
      const orgId = randomUUID();
      await db.organization.create({
        data: { id: orgId, code: 'LOAD', name: '合成负载测试组织', type: 'FIRM', path: '/' + orgId },
      });
      for (let i = 0; i < 100; i++) {
        const user = await db.user.create({
          data: { username: 'load-' + i, password: 'unused-fixture', mustChangePassword: false },
        });
        const session = await createApiSession(db, user.id);
        clients.push({
          id: user.id,
          ...session,
          profile: i % 3,
          pending: false,
          stopped: false,
          ready: false,
        });
      }
      const workspace = await db.collabWorkspace.create({
        data: {
          organizationId: orgId,
          name: 'P1 负载测试',
          ownerId: clients[0].id,
          members: {
            create: clients.map((c, i) => ({
              principalId: c.id,
              role: i === 0 ? 'OWNER' : c.profile === 0 ? 'MANAGER' : 'EDITOR',
              rowScope: c.profile === 1 ? 'SELF' : 'ALL',
              hiddenFields: c.profile === 2 ? [fieldIds[49]] : [],
              canCreate: true,
            })),
          },
        },
      });
      const workspaceId = workspace.id;
      baseId = (await db.collabBase.create({ data: { workspaceId, name: '十表应用' } })).id;
      for (let i = 0; i < 10; i++) {
        const table = await db.collabTable.create({
          data: { baseId, name: '负载表-' + i, position: i, createdBy: clients[0].id },
        });
        const fields = i === 0 ? fieldIds : Array.from({ length: 50 }, () => randomUUID());
        await db.collabField.createMany({
          data: fields.map((id, n) => ({
            id,
            tableId: table.id,
            name: '字段-' + n,
            type: n === 1 ? 'NUMBER' : n === 2 ? 'SINGLE_SELECT' : 'TEXT',
            required: n === 0,
            position: n,
            options:
              n === 2
                ? { choices: Array.from({ length: 10 }, (_, k) => ({ id: 'g' + k, name: '组' + k })) }
                : {},
          })),
        });
        await db.collabView.create({
          data: { tableId: table.id, name: '总表', ownerId: clients[0].id, shared: true, isDefault: true },
        });
        if (i === 0) tableId = table.id;
      }
      for (let offset = 0; offset < 10000; offset += 250) {
        await db.collabRecord.createMany({
          data: Array.from({ length: 250 }, (_, n) => {
            const i = offset + n,
              userId = clients[i % 100].id;
            return {
              id: rowId(i),
              tableId,
              createdBy: userId,
              updatedBy: userId,
              ownerId: userId,
              createdAt: new Date(Date.UTC(2025, 0, 1) + i * 1000),
              values: Object.fromEntries(
                fieldIds.map((id, f) => [
                  id,
                  f === 1 ? i : f === 2 ? 'g' + (i % 10) : '合成记录-' + i + '-字段-' + f,
                ]),
              ),
            };
          }),
        });
      }
      await db.$executeRawUnsafe('ANALYZE collab_record');
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        await (await fetch(origin + '/api/health')).text();
        latencies.rtt.push(performance.now() - t);
      }
      for (const [i, client] of clients.entries()) {
        pumps.push(connect(client, i));
        await sleep(10);
      }
      const deadline = Date.now() + 30000;
      while (clients.some((c) => !c.ready) && Date.now() < deadline) await sleep(100);
      assert.equal(clients.filter((c) => c.ready).length, 100, 'all sessions must be ready');
      measuredStart = Date.now();
      workers = clients.slice(0, 20).map(async (client, i) => {
        let round = 0;
        for (let slot = 0; slot < Math.floor(seconds / 5); slot++) {
          await sleep(Math.max(0, measuredStart + i * 250 + slot * 5000 - Date.now()));
          if (!running || Date.now() - measuredStart >= seconds * 1000) break;
          try {
            const current = await request(
              client,
              '/tables/' + tableId + '/records/' + rowId(i),
              undefined,
              'GET',
            );
            latencies.query.push(current.elapsed);
            if (current.status !== 200 || !current.data) throw new Error('record unavailable');
            const saved = await request(
              client,
              '/tables/' + tableId + '/records/' + rowId(i),
              {
                schemaVersion: 1,
                version: current.data.record.version,
                values: { [fieldIds[0]]: '写入-' + i + '-' + round++ },
              },
              'PATCH',
            );
            latencies.save.push(saved.elapsed);
            if (saved.status !== 200 || !saved.data) fail('save:' + saved.status + ':' + saved.code);
            else {
              committed++;
              if ((observed.get(rowId(i)) || 0) >= saved.data.version) latencies.visible.push(0);
              else pending.push({ id: rowId(i), version: saved.data.version, at: Date.now() });
            }
          } catch {
            fail('save:transport');
          }
        }
      });
      let renewed = false;
      while (running && Date.now() - measuredStart < seconds * 1000) {
        peakOnline = Math.max(peakOnline, clients.filter((c) => c.ready).length);
        await writeFile(
          path.join(evidence, 'load-progress.json'),
          JSON.stringify({
            elapsedSeconds: Math.floor((Date.now() - measuredStart) / 1000),
            online: clients.filter((c) => c.ready).length,
            committed,
            queries: latencies.query.length,
            errors,
          }),
        );
        if (!renewed && Date.now() - measuredStart > Math.min(600000, seconds * 500)) {
          renewed = true;
          for (const client of clients) {
            const response = await fetch(origin + '/api/v1/auth/refresh', {
              method: 'POST',
              headers: {
                Cookie: 'chengye_refresh=' + client.refreshToken + '; chengye_csrf=' + client.csrfToken,
                'x-csrf-token': client.csrfToken,
                Origin: ready.trustedOrigin as string,
              },
            });
            assert.equal(response.status, 200, 'refresh must succeed');
            const body = (await response.json()) as { data: { token?: string; accessToken?: string } };
            client.token = body.data.accessToken || body.data.token || '';
            assert.ok(client.token, 'refresh returned access token');
            client.reconnectAt = Date.now();
            client.abort?.abort();
          }
        }
        await sleep(1000);
      }
      await Promise.all(workers);
      const measuredEnd = Date.now();
      await sleep(3000);
      const target = clients[99],
        revokedStart = Date.now();
      await db.collabMember.deleteMany({ where: { workspaceId, principalId: target.id } });
      const deniedRead = await request(target, '/tables/' + tableId + '/records/query', {});
      const deniedWrite = await request(
        target,
        '/tables/' + tableId + '/records/' + rowId(99),
        { version: 1, schemaVersion: 1, values: { [fieldIds[0]]: '拒绝写入' } },
        'PATCH',
      );
      while (!target.revokedAt && Date.now() - revokedStart < 6000) await sleep(50);
      const revocationMs = target.revokedAt ? target.revokedAt - revokedStart : null;
      const report = {
        serverMetrics: await serverMetrics(),
        loadGeneratorEventLoopMs: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 },
        baseline: {
          tables: 10,
          rows: 10000,
          fields: 50,
          sessions: 100,
          activeWriters: 20,
          intervalSeconds: 5,
          requiredSeconds: 900,
          actualSeconds: (measuredEnd - measuredStart) / 1000,
          fullDuration: seconds >= 900,
          profiles: ['ALL manager', 'SELF editor', 'ALL editor with hidden field'],
        },
        environment: {
          platform: os.platform(),
          release: os.release(),
          node: process.version,
          cpu: os.cpus()[0].model,
          logicalCpus: os.cpus().length,
          memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
          database: await db.$queryRaw`SELECT version()`,
          network:
            'same-host loopback; separate server and load-generator processes; HTTP health latency measured separately',
          databaseIndexes:
            await db.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('collab_record', 'collab_event', 'collab_presence')`,
        },
        metrics: Object.fromEntries(Object.entries(latencies).map(([k, v]) => [k, summary(v)])),
        committed,
        expectedCommits: Math.floor(seconds / 5) * 20,
        invalidations,
        peakOnline,
        errors,
        unobservedCommits: pending.length,
        revocationMs,
        deniedRead: deniedRead.status,
        deniedWrite: deniedWrite.status,
      };
      await writeFile(
        path.join(evidence, 'load-report.json'),
        JSON.stringify({ status: 'measured', ...report }, null, 2),
      );
      reportWritten = true;
      console.log(
        JSON.stringify({ ...report, environment: { ...report.environment, databaseIndexes: undefined } }),
      );
      assert.deepEqual(errors, {}, 'unexpected failures are counted, not excluded');
      assert.ok(committed >= Math.floor(seconds / 5) * 20, 'writers did not sustain the requested cadence');
      assert.equal(pending.length, 0, 'all acknowledged commits must become visible');
      assert.equal(peakOnline, 100);
      for (const kind of ['query', 'save', 'visible'])
        assert.ok((summary(latencies[kind]).p95 ?? Infinity) <= 2000, kind + ' P95 > 2s');
      assert.equal(latencies.reconnect.length, 100);
      assert.ok((summary(latencies.reconnect).p95 ?? Infinity) <= 5000, 'reconnect P95 > 5s');
      assert.ok(revocationMs !== null && revocationMs <= 5000, 'revocation > 5s');
      assert.equal(deniedRead.status, 403);
      assert.equal(deniedWrite.status, 403);
      await writeFile(
        path.join(evidence, 'load-report.json'),
        JSON.stringify({ status: 'passed', ...report }, null, 2),
      );
    } catch (error) {
      if (reportWritten) {
        const report = JSON.parse(await readFile(path.join(evidence, 'load-report.json'), 'utf8'));
        await writeFile(
          path.join(evidence, 'load-report.json'),
          JSON.stringify(
            { ...report, status: 'failed', reason: (error as Error).message.slice(-300) },
            null,
            2,
          ),
        );
      } else {
        await writeFile(
          path.join(evidence, 'load-report.json'),
          JSON.stringify(
            {
              status: 'aborted',
              requestedSeconds: seconds,
              measuredSeconds: measuredStart ? (Date.now() - measuredStart) / 1000 : 0,
              fullDuration: false,
              committed,
              invalidations,
              peakOnline,
              errors,
              metrics: Object.fromEntries(Object.entries(latencies).map(([k, v]) => [k, summary(v)])),
              serverMetrics: await serverMetrics().catch(() => null),
              loadGeneratorEventLoopMs: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 },
              failure: (error as Error).name,
              reason: (error as Error).message.slice(-300),
            },
            null,
            2,
          ),
        );
      }
      throw error;
    } finally {
      loop.disable();
      running = false;
      for (const client of clients) client.abort?.abort();
      await Promise.allSettled(pumps);
      await Promise.allSettled(workers);
      await Promise.allSettled(clients.flatMap((c) => (c.reading ? [c.reading] : [])));
      if (server.exitCode === null && server.connected) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            server.kill();
            resolve();
          }, 15000);
          server.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          server.send({ type: 'stop' });
        });
      }
      await clearTestApplicationData(db);
      await db.$disconnect();
    }
  },
);
