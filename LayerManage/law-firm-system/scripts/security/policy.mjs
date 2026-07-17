import { readFileSync } from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKSPACE_PATHS = new Map([
  ['server', 'apps/server'],
  ['web', 'apps/web'],
]);
const WORKSPACES = new Set(WORKSPACE_PATHS.keys());
const SEVERITIES = ['critical', 'high', 'moderate', 'low'];
const EXCEPTION_FIELDS = [
  'id',
  'workspace',
  'package',
  'advisories',
  'scope',
  'reason',
  'mitigation',
  'owner',
  'approvedBy',
  'createdAt',
  'expiresAt',
  'trackingRef',
];

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown field: ${unknown[0]}`);
  const missing = allowed.filter(key => !Object.hasOwn(value, key));
  if (missing.length > 0) fail(`${label} is missing field: ${missing[0]}`);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function relativePath(value, label) {
  const candidate = nonEmptyString(value, label);
  const segments = candidate.replaceAll('\\', '/').split('/');
  if (path.isAbsolute(candidate) || segments.includes('..') || segments.includes('') || candidate.includes('*')) {
    fail(`${label} must be a safe relative workspace path`);
  }
  return candidate;
}

function isoDate(value, label) {
  const candidate = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) fail(`${label} must be a valid ISO date`);
  const timestamp = Date.parse(`${candidate}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== candidate) {
    fail(`${label} must be a valid ISO date`);
  }
  return timestamp;
}

function validateGate(value, label, expected) {
  const gate = record(value, label);
  exactKeys(gate, SEVERITIES, label);
  for (const severity of SEVERITIES) {
    if (gate[severity] !== expected[severity]) {
      fail(`${label}.${severity} must be ${expected[severity]}`);
    }
  }
  return gate;
}

export function validatePolicy(value) {
  const policy = record(value, 'dependency policy');
  exactKeys(policy, [
    'schemaVersion',
    'workspaces',
    'gates',
    'maxDevelopmentExceptionDays',
    'outputDirectory',
  ], 'dependency policy');
  if (policy.schemaVersion !== 1) fail('dependency policy schemaVersion must be 1');
  if (!Array.isArray(policy.workspaces) || policy.workspaces.length !== WORKSPACES.size) {
    fail('dependency policy must define server and web workspaces');
  }

  const names = new Set();
  for (const [index, item] of policy.workspaces.entries()) {
    const workspace = record(item, `workspace ${index}`);
    exactKeys(workspace, ['name', 'path'], `workspace ${index}`);
    const name = nonEmptyString(workspace.name, `workspace ${index}.name`);
    if (!WORKSPACES.has(name)) fail(`unsupported workspace: ${name}`);
    if (names.has(name)) fail(`duplicate workspace: ${name}`);
    names.add(name);
    const workspacePath = relativePath(workspace.path, `workspace ${name}.path`);
    if (workspacePath !== WORKSPACE_PATHS.get(name)) {
      fail(`workspace ${name}.path must be ${WORKSPACE_PATHS.get(name)}`);
    }
  }
  if ([...WORKSPACES].some(name => !names.has(name))) fail('dependency policy must define server and web workspaces');

  const gates = record(policy.gates, 'dependency policy gates');
  exactKeys(gates, ['production', 'development'], 'dependency policy gates');
  validateGate(gates.production, 'production gate', {
    critical: 'block', high: 'block', moderate: 'report', low: 'report',
  });
  validateGate(gates.development, 'development gate', {
    critical: 'block', high: 'exception', moderate: 'report', low: 'report',
  });
  if (policy.maxDevelopmentExceptionDays !== 30) {
    fail('maxDevelopmentExceptionDays must be 30');
  }
  relativePath(policy.outputDirectory, 'outputDirectory');
  return policy;
}

export function validateExceptions(value, policy, now = new Date()) {
  const document = record(value, 'dependency exceptions');
  exactKeys(document, ['schemaVersion', 'exceptions'], 'dependency exceptions');
  if (document.schemaVersion !== 1) fail('dependency exceptions schemaVersion must be 1');
  if (!Array.isArray(document.exceptions)) fail('dependency exceptions must be an array');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('validation time must be a valid Date');

  const workspaceNames = new Set(policy.workspaces.map(workspace => workspace.name));
  const ids = new Set();
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

  for (const [index, item] of document.exceptions.entries()) {
    const exception = record(item, `exception ${index}`);
    exactKeys(exception, EXCEPTION_FIELDS, `exception ${index}`);
    for (const field of EXCEPTION_FIELDS.filter(field => field !== 'advisories')) {
      nonEmptyString(exception[field], `exception ${index}.${field}`);
    }
    if (ids.has(exception.id)) fail(`duplicate exception id: ${exception.id}`);
    ids.add(exception.id);
    if (!workspaceNames.has(exception.workspace)) fail(`unsupported workspace: ${exception.workspace}`);
    if (exception.package.includes('*')) fail('exception package must not contain a wildcard');
    if (exception.scope !== 'development') fail('exception scope must be development');
    if (exception.owner === exception.approvedBy) fail('exception owner and approvedBy must be different');

    if (!Array.isArray(exception.advisories) || exception.advisories.length === 0) {
      fail('exception advisories must be a non-empty array');
    }
    const advisories = new Set();
    for (const advisory of exception.advisories) {
      nonEmptyString(advisory, 'exception advisory');
      if (!/^GHSA-[0-9a-z-]+$/.test(advisory) && !/^npm:\d+$/.test(advisory)) {
        fail(`invalid exception advisory: ${advisory}`);
      }
      if (advisories.has(advisory)) fail(`duplicate advisory: ${advisory}`);
      advisories.add(advisory);
    }

    const createdAt = isoDate(exception.createdAt, 'createdAt');
    const expiresAt = isoDate(exception.expiresAt, 'expiresAt');
    if (expiresAt <= createdAt) fail('expiresAt must be after createdAt');
    if ((expiresAt - createdAt) / DAY_MS > policy.maxDevelopmentExceptionDays) {
      fail(`exception lifetime must not exceed ${policy.maxDevelopmentExceptionDays} days`);
    }
    if (createdAt > today) fail(`exception ${exception.id} has a future createdAt date`);
    if (expiresAt < today) fail(`exception ${exception.id} is expired`);
  }

  return document.exceptions;
}

export function loadSecurityConfiguration(projectRoot, now = new Date()) {
  const read = name => JSON.parse(readFileSync(path.resolve(projectRoot, 'security', name), 'utf8'));
  const policy = validatePolicy(read('dependency-policy.json'));
  return {
    policy,
    exceptions: validateExceptions(read('dependency-exceptions.json'), policy, now),
  };
}
