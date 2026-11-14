const DEVELOPMENT_ORIGIN = 'http://localhost:3000';

function invalid(): never {
  throw new Error('CORS_ALLOWED_ORIGINS must contain unique HTTP(S) origins without paths or credentials');
}

export function parseCorsAllowedOrigins(raw: string | undefined, nodeEnv: string): string[] {
  const source = raw?.trim();
  if (!source) {
    if (nodeEnv === 'production') throw new Error('CORS_ALLOWED_ORIGINS is required in production');
    return [DEVELOPMENT_ORIGIN];
  }

  const origins = source.split(',').map(value => {
    const candidate = value.trim();
    if (!candidate || candidate === '*') return invalid();
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return invalid();
    }
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash) {
      return invalid();
    }
    return url.origin;
  });

  if (new Set(origins).size !== origins.length) {
    throw new Error('CORS_ALLOWED_ORIGINS contains a duplicate origin');
  }
  return origins;
}

export function resolveCorsOrigin(requestOrigin: string, allowedOrigins: readonly string[]): string {
  if (!requestOrigin) return '';
  try {
    const normalized = new URL(requestOrigin).origin;
    return requestOrigin === normalized && allowedOrigins.includes(normalized) ? normalized : '';
  } catch {
    return '';
  }
}
