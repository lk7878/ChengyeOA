export function assertSafeSeedTestDatabaseUrl(rawUrl: string | undefined): URL {
  if (!rawUrl) throw new Error('DATABASE_URL_TEST is required');

  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:') throw new Error('Seed test requires PostgreSQL');
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Seed test database host must be localhost or 127.0.0.1');
  }
  if (url.port !== '55432') throw new Error('Seed test database must use port 55432');
  if (!url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Seed test database name must end with _test');
  }

  return url;
}
