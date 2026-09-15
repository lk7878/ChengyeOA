import { PrismaClient } from '@prisma/client';

// Only base-wide invalidation cursors and presence are shared. Every subscriber must
// freshly authorize before using this result; no records, fields or grants are cached.
type Pulse = {
  event: { id: bigint; kind: string } | null;
  accessId: bigint;
  users: { id: string; name: string }[];
};
const caches = new WeakMap<PrismaClient, Map<string, { at: number; value: Promise<Pulse> }>>();
export function basePulse(db: PrismaClient, baseId: string): Promise<Pulse> {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  const previous = cache.get(baseId);
  if (previous && Date.now() - previous.at < 500) return previous.value;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const value = (async () => {
    const [event, access, presence] = await Promise.all([
      db.collabEvent.findFirst({
        where: { baseId },
        orderBy: { id: 'desc' },
        select: { id: true, kind: true },
      }),
      db.collabEvent.findFirst({
        where: { baseId, kind: 'access.updated' },
        orderBy: { id: 'desc' },
        select: { id: true },
      }),
      db.collabPresence.findMany({
        where: { baseId, seenAt: { gt: new Date(Date.now() - 6000) } },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);
    const users = await db.user.findMany({
      where: { id: { in: presence.map((p) => p.userId) }, status: 'ENABLED' },
      orderBy: { id: 'asc' },
      select: { id: true, username: true, employee: { select: { name: true } } },
    });
    return {
      event,
      accessId: access?.id ?? 0n,
      users: users.map((u) => ({ id: u.id, name: u.employee?.name || u.username })),
    };
  })();
  cache.set(baseId, { at: Date.now(), value });
  return value;
}
