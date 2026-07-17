import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateWorkspace, normalizeFindings, parseAuditJson } from './audit-gate.mjs';
import { validateExceptions, validatePolicy } from './policy.mjs';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtureSource = name => readFileSync(path.join(fixtureRoot, name), 'utf8');
const fixture = name => parseAuditJson(fixtureSource(name));

const policy = validatePolicy({
  schemaVersion: 1,
  workspaces: [
    { name: 'server', path: 'apps/server' },
    { name: 'web', path: 'apps/web' },
  ],
  gates: {
    production: { critical: 'block', high: 'block', moderate: 'report', low: 'report' },
    development: { critical: 'block', high: 'exception', moderate: 'report', low: 'report' },
  },
  maxDevelopmentExceptionDays: 30,
  outputDirectory: 'var/security',
});

function exceptionDocument(advisories = ['GHSA-fx2h-pf6j-xcff']) {
  return {
    schemaVersion: 1,
    exceptions: [{
      id: 'SEC-2026-001',
      workspace: 'web',
      package: 'vite',
      advisories,
      scope: 'development',
      reason: 'No compatible upstream release is available.',
      mitigation: 'The package is restricted to isolated development execution.',
      owner: 'platform-engineering',
      approvedBy: 'system-super-admin',
      createdAt: '2026-07-16',
      expiresAt: '2026-08-15',
      trackingRef: 'SEC-SPEC-001/vite',
    }],
  };
}

test('parses a clean npm audit v2 report', () => {
  const report = fixture('clean.json');
  assert.equal(report.auditReportVersion, 2);
  assert.deepEqual(normalizeFindings(report), []);
});

test('deduplicates an advisory reached through a parent via reference', () => {
  assert.deepEqual(normalizeFindings(fixture('production-high.json')), [{
    package: 'undici',
    advisory: 'GHSA-vxpw-j846-p89q',
    severity: 'high',
  }]);
});

test('blocks every production high finding without consulting exceptions', () => {
  const result = evaluateWorkspace({
    workspace: 'server',
    productionReport: fixture('production-high.json'),
    fullReport: fixture('production-high.json'),
    policy,
    exceptions: [],
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, [{
    package: 'undici', advisory: 'GHSA-vxpw-j846-p89q', severity: 'high', scope: 'production',
  }]);
});

test('allows an exact development high exception', () => {
  const exceptions = validateExceptions(
    exceptionDocument(),
    policy,
    new Date('2026-07-16T00:00:00Z'),
  );
  const result = evaluateWorkspace({
    workspace: 'web',
    productionReport: fixture('clean.json'),
    fullReport: fixture('development-high.json'),
    policy,
    exceptions,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.findings[0].scope, 'development');
});

test('does not let an exception hide a different advisory for the same package', () => {
  const exceptions = validateExceptions(
    exceptionDocument(['GHSA-not-the-finding']),
    policy,
    new Date('2026-07-16T00:00:00Z'),
  );
  const result = evaluateWorkspace({
    workspace: 'web',
    productionReport: fixture('clean.json'),
    fullReport: fixture('development-high.json'),
    policy,
    exceptions,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers.map(item => item.advisory), ['GHSA-fx2h-pf6j-xcff']);
});

test('blocks a development critical finding even when a matching exception exists', () => {
  const report = structuredClone(fixture('development-high.json'));
  report.vulnerabilities.vite.severity = 'critical';
  report.vulnerabilities.vite.via[0].severity = 'critical';
  report.metadata.vulnerabilities.high = 0;
  report.metadata.vulnerabilities.critical = 1;
  const exceptions = validateExceptions(
    exceptionDocument(),
    policy,
    new Date('2026-07-16T00:00:00Z'),
  );

  const result = evaluateWorkspace({
    workspace: 'web', productionReport: fixture('clean.json'), fullReport: report, policy, exceptions,
  });
  assert.equal(result.passed, false);
  assert.equal(result.blockers[0].severity, 'critical');
});

test('fails closed for empty, malformed, and unsupported audit output', () => {
  assert.throws(() => parseAuditJson(''), /empty/i);
  assert.throws(() => parseAuditJson(fixtureSource('truncated.json')), /valid JSON/i);
  assert.throws(() => parseAuditJson(JSON.stringify({ auditReportVersion: 3 })), /version 2/i);
});

test('fails when severe metadata cannot be tied to a concrete advisory', () => {
  const report = structuredClone(fixture('development-high.json'));
  report.vulnerabilities.vite.via = ['missing-child'];
  assert.throws(() => normalizeFindings(report), /concrete advisory/i);
});

test('fails when any severe advisory reference cannot be resolved', () => {
  const report = structuredClone(fixture('development-high.json'));
  report.vulnerabilities.vite.via.push('missing-child');
  assert.throws(() => normalizeFindings(report), /missing-child/i);
});

test('fails when a severe advisory entry has no concrete identifier', () => {
  const report = structuredClone(fixture('development-high.json'));
  report.vulnerabilities.vite.via.push({
    name: 'vite', severity: 'high', title: 'missing identifier',
  });
  assert.throws(() => normalizeFindings(report), /concrete advisory/i);
});
