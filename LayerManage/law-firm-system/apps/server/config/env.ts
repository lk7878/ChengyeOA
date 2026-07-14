export interface AppEnvironment {
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  appKeys: string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const databaseUrl = required(env, 'DATABASE_URL');
  const jwtSecret = required(env, 'JWT_SECRET');
  const appKeys = required(env, 'APP_KEYS').split(',').map(value => value.trim()).filter(Boolean);

  if (!databaseUrl.startsWith('postgresql://')) throw new Error('DATABASE_URL must use PostgreSQL');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if (appKeys.length < 2 || appKeys.some(key => key.length < 24)) {
    throw new Error('APP_KEYS must contain at least two comma-separated keys of 24 characters');
  }
  if (nodeEnv === 'production' && /replace_with|change_me|local_only/i.test(`${databaseUrl}|${jwtSecret}|${appKeys.join(',')}`)) {
    throw new Error('Production environment contains sample DATABASE_URL, JWT_SECRET, or APP_KEYS values');
  }

  return { nodeEnv, databaseUrl, jwtSecret, appKeys };
}

export function loadProductionEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  env.NODE_ENV = 'production';
  return loadEnvironment(env);
}
