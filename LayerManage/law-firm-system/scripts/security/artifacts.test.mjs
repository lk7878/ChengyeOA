import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeAuditSummary, writeSbom } from './artifacts.mjs';

const metadata = {
  commit: '0123456789abcdef',
  node: 'v22.14.0',
  npm: '10.9.2',
  generatedAt: '2026-07-17T00:00:00.000Z',
};

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'chengye-security-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('writes only sanitized audit summary fields', t => {
  const output = temporaryDirectory(t);
  const file = writeAuditSummary(output, 'production', [{
    workspace: 'server',
    passed: false,
    counts: {
      production: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      development: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    findings: [{
      package: 'undici', advisory: 'GHSA-vxpw-j846-p89q', severity: 'high', scope: 'production',
      path: 'C:\\Users\\secret', token: 'do-not-write',
    }],
    blockers: [],
    databaseUrl: 'postgresql://secret',
  }], metadata);

  const source = readFileSync(file, 'utf8');
  const summary = JSON.parse(source);
  assert.equal(summary.workspaces[0].findings[0].package, 'undici');
  assert.deepEqual(Object.keys(summary.workspaces[0].findings[0]).sort(), ['advisory', 'package', 'scope', 'severity']);
  assert.doesNotMatch(source, /Users|token|postgresql/i);
});

test('adds traceability properties to a separate CycloneDX SBOM', t => {
  const output = temporaryDirectory(t);
  const file = writeSbom(output, 'web', {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component: { type: 'application', name: 'law-firm-web' } },
    components: [],
  }, metadata);

  const sbom = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(path.basename(file), 'web.cdx.json');
  assert.equal(sbom.metadata.properties.find(item => item.name === 'chengye.workspace').value, 'web');
  assert.equal(sbom.metadata.properties.find(item => item.name === 'chengye.commit').value, metadata.commit);
});

test('rejects unsupported SBOM data before writing', t => {
  const output = temporaryDirectory(t);
  assert.throws(() => writeSbom(output, 'server', { bomFormat: 'SPDX' }, metadata), /CycloneDX 1.5/i);
});
