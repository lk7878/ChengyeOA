export interface HealthQueryable {
  $queryRaw(query: TemplateStringsArray): Promise<unknown>;
}

export async function databaseAvailability(client: HealthQueryable): Promise<'available' | 'unavailable'> {
  try {
    await client.$queryRaw`SELECT 1`;
    return 'available';
  } catch {
    return 'unavailable';
  }
}

export function databaseHealthResponse(database: 'available' | 'unavailable') {
  if (database === 'available') {
    return {
      statusCode: 200,
      body: { code: 200, message: 'success', data: { status: 'healthy', database } },
    };
  }
  return {
    statusCode: 503,
    body: { code: 503, message: 'service unavailable', data: { status: 'degraded', database } },
  };
}
