import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * 临时探针（SPEC-011/012 运行纪律）：等共享 55433 测试库 ACTIVE 连接归零。
 * 用法：DB 闸门前运行；输出 active/row；ACTIVE>0 时以非零退出。
 */
async function main() {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '';
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const self = await client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const selfPid = Number(self[0]?.pid ?? -1);
    const rows = await client.$queryRaw<
      { pid: number; state: string; query: string }[]
    >`SELECT pid, state, left(query, 80) AS query FROM pg_stat_activity WHERE datname = current_database() AND pid <> ${selfPid} AND state IS NOT NULL`;
    const active = rows.filter(r => r.state === 'active');
    console.log(`probe: total=${rows.length} active=${active.length}`);
    if (active.length > 0) {
      for (const r of rows) console.log(`  pid=${r.pid} state=${r.state} query=${r.query}`);
      process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
  }
}

void main();
