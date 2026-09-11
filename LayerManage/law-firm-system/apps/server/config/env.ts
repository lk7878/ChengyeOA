import { parseCorsAllowedOrigins } from './cors';

export interface AppEnvironment {
  nodeEnv: string;
  production: boolean;
  localPasswordLogin: boolean;
  databaseUrl: string;
  jwtSecret: string;
  appKeys: string[];
  corsAllowedOrigins: string[];
  trustedOrigins: string[];
  mfaEncryptionKeys: ReadonlyMap<number, Buffer>;
  eventWorker: EventWorkerEnvironment;
  eventObservability: EventObservabilityEnvironment;
  leadRecycle: LeadRecycleEnvironment;
  approvalTimeout: ApprovalTimeoutEnvironment;
}

export interface EventWorkerEnvironment {
  enabled: boolean;
  pollMs: number;
  batchSize: number;
  leaseSeconds: number;
  shutdownSeconds: number;
}

export interface EventObservabilityEnvironment {
  readonly heartbeatSeconds: number;
  readonly heartbeatStaleSeconds: number;
  readonly undispatchedBlockSeconds: number;
  readonly dueBacklogBlockSeconds: number;
  readonly leaseLostDegradedCount: number;
  readonly leaseLostBlockedCount: number;
  readonly canaryWindowMinutes: number;
}

/** SPEC-009 Task 9：首响超时回收扫描配置（LeadRecycleScanner 随事件 Worker tick 驱动）。 */
export interface LeadRecycleEnvironment {
  enabled: boolean;
  noFollowHours: number;
}

/** SPEC-021 Task 1：审批超时升级扫描配置（ApprovalTimeoutScanner 随事件 Worker tick 驱动）。 */
export interface ApprovalTimeoutEnvironment {
  timeoutHours: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const production = nodeEnv === 'production';
  const databaseUrl = required(env, 'DATABASE_URL');
  const jwtSecret = required(env, 'JWT_SECRET');
  const appKeys = required(env, 'APP_KEYS').split(',').map(value => value.trim()).filter(Boolean);
  const mfaEncryptionKeyV1 = parseBase64Key(required(env, 'MFA_ENCRYPTION_KEY_V1'));

  if (!databaseUrl.startsWith('postgresql://')) throw new Error('DATABASE_URL must use PostgreSQL');
  const localPasswordLogin = env.LOCAL_PASSWORD_LOGIN === 'true';
  if (env.LOCAL_PASSWORD_LOGIN !== undefined && !['true', 'false'].includes(env.LOCAL_PASSWORD_LOGIN)) {
    throw new Error('LOCAL_PASSWORD_LOGIN must be true or false');
  }
  if (localPasswordLogin && (nodeEnv !== 'development'
    || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))) {
    throw new Error('LOCAL_PASSWORD_LOGIN requires development mode and a local database');
  }
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if (appKeys.length < 2 || appKeys.some(key => key.length < 24)) {
    throw new Error('APP_KEYS must contain at least two comma-separated keys of 24 characters');
  }
  if (production && /replace_with|change_me|local_only/i.test(
    `${databaseUrl}|${jwtSecret}|${appKeys.join(',')}|${env.MFA_ENCRYPTION_KEY_V1}`,
  )) {
    throw new Error('Production environment contains sample DATABASE_URL, JWT_SECRET, APP_KEYS, or MFA_ENCRYPTION_KEY_V1 values');
  }

  const corsAllowedOrigins = parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS, nodeEnv);
  const eventWorker = parseEventWorkerEnvironment(env, nodeEnv, production);
  const eventObservability = parseEventObservabilityEnvironment(env);
  const leadRecycle = parseLeadRecycleEnvironment(env);
  const approvalTimeout = parseApprovalTimeoutEnvironment(env);
  return {
    nodeEnv,
    production,
    localPasswordLogin,
    databaseUrl,
    jwtSecret,
    appKeys,
    corsAllowedOrigins,
    trustedOrigins: [...corsAllowedOrigins],
    mfaEncryptionKeys: new Map([[1, mfaEncryptionKeyV1]]),
    eventWorker,
    eventObservability,
    leadRecycle,
    approvalTimeout,
  };
}

export function loadProductionEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  env.NODE_ENV = 'production';
  return loadEnvironment(env);
}

function parseBase64Key(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('MFA_ENCRYPTION_KEY_V1 must use canonical Base64');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY_V1 must decode to exactly 32 bytes');
  return key;
}

function parseEventWorkerEnvironment(
  env: NodeJS.ProcessEnv,
  nodeEnv: string,
  production: boolean,
): EventWorkerEnvironment {
  const enabledValue = env.EVENT_WORKER_ENABLED;
  let enabled: boolean;
  if (enabledValue === undefined) {
    if (production) throw new Error('EVENT_WORKER_ENABLED is required in production');
    enabled = nodeEnv !== 'test' && nodeEnv !== 'unittest' && env.EGG_SERVER_ENV !== 'unittest';
  } else if (enabledValue === 'true') {
    enabled = true;
  } else if (enabledValue === 'false') {
    enabled = false;
  } else {
    throw new Error('EVENT_WORKER_ENABLED must be exactly true or false');
  }

  const pollMs = parseDecimalInteger(env, 'EVENT_WORKER_POLL_MS', 1000, 250, 60_000);
  const batchSize = parseDecimalInteger(env, 'EVENT_WORKER_BATCH_SIZE', 25, 1, 200);
  const leaseSeconds = parseDecimalInteger(env, 'EVENT_WORKER_LEASE_SECONDS', 60, 30, 600);
  const shutdownSeconds = parseDecimalInteger(env, 'EVENT_WORKER_SHUTDOWN_SECONDS', 30, 1, 120);
  if (shutdownSeconds >= leaseSeconds) {
    throw new Error('EVENT_WORKER_SHUTDOWN_SECONDS must be less than EVENT_WORKER_LEASE_SECONDS');
  }

  return { enabled, pollMs, batchSize, leaseSeconds, shutdownSeconds };
}

function parseEventObservabilityEnvironment(env: NodeJS.ProcessEnv): EventObservabilityEnvironment {
  const heartbeatSeconds = parseDecimalInteger(env, 'EVENT_OBSERVABILITY_HEARTBEAT_SECONDS', 10, 5, 60);
  const undispatchedBlockSeconds = parseDecimalInteger(
    env,
    'EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS',
    120,
    30,
    3_600,
  );
  const dueBacklogBlockSeconds = parseDecimalInteger(
    env,
    'EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS',
    300,
    60,
    86_400,
  );
  const leaseLostDegradedCount = parseDecimalInteger(
    env,
    'EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT',
    1,
    1,
    99,
  );
  const leaseLostBlockedCount = parseDecimalInteger(
    env,
    'EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT',
    3,
    2,
    100,
  );
  if (leaseLostBlockedCount <= leaseLostDegradedCount) {
    throw new Error(
      'EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT must be greater than EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT',
    );
  }
  const canaryWindowMinutes = parseDecimalInteger(
    env,
    'EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES',
    15,
    5,
    120,
  );

  return {
    heartbeatSeconds,
    heartbeatStaleSeconds: Math.max(60, heartbeatSeconds * 3),
    undispatchedBlockSeconds,
    dueBacklogBlockSeconds,
    leaseLostDegradedCount,
    leaseLostBlockedCount,
    canaryWindowMinutes,
  };
}

function parseLeadRecycleEnvironment(env: NodeJS.ProcessEnv): LeadRecycleEnvironment {
  // 布尔模式与 EVENT_WORKER_ENABLED 一致（显式 'true'/'false'，其余 fail-fast），
  // 但未设置时默认启用（无生产强制要求）。
  const enabledValue = env.LEAD_RECYCLE_ENABLED;
  let enabled: boolean;
  if (enabledValue === undefined) {
    enabled = true;
  } else if (enabledValue === 'true') {
    enabled = true;
  } else if (enabledValue === 'false') {
    enabled = false;
  } else {
    throw new Error('LEAD_RECYCLE_ENABLED must be exactly true or false');
  }

  const noFollowHours = parseDecimalInteger(env, 'LEAD_RECYCLE_NO_FOLLOW_HOURS', 24, 1, 720);
  return { enabled, noFollowHours };
}

function parseApprovalTimeoutEnvironment(env: NodeJS.ProcessEnv): ApprovalTimeoutEnvironment {
  const timeoutHours = parseDecimalInteger(env, 'APPROVAL_TIMEOUT_HOURS', 72, 1, 8760);
  return { timeoutHours };
}

function parseDecimalInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a decimal integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}
