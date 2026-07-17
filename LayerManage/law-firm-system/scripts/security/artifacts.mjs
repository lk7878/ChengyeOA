import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical', 'total'];
const TRACEABILITY_PROPERTIES = ['commit', 'workspace', 'node', 'npm', 'generatedAt'];

function fail(message) {
  throw new Error(message);
}

function metadataRecord(metadata) {
  const result = {};
  for (const key of ['commit', 'node', 'npm', 'generatedAt']) {
    if (typeof metadata[key] !== 'string' || metadata[key].length === 0) fail(`artifact metadata.${key} is required`);
    result[key] = metadata[key];
  }
  return result;
}

function countsRecord(counts) {
  return Object.fromEntries(SEVERITIES.map(key => [key, Number.isInteger(counts?.[key]) ? counts[key] : 0]));
}

function atomicJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, file);
  return file;
}

export function writeAuditSummary(outputDirectory, name, summaries, metadata) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('audit summary name is invalid');
  const document = {
    schemaVersion: 1,
    kind: name,
    metadata: metadataRecord(metadata),
    workspaces: summaries.map(summary => ({
      workspace: summary.workspace,
      passed: summary.passed === true,
      counts: {
        production: countsRecord(summary.counts?.production),
        development: countsRecord(summary.counts?.development),
      },
      findings: summary.findings.map(finding => ({
        package: finding.package,
        advisory: finding.advisory,
        severity: finding.severity,
        scope: finding.scope,
      })),
    })),
  };
  return atomicJson(path.join(outputDirectory, 'audit', `${name}-summary.json`), document);
}

export function writeSbom(outputDirectory, workspace, source, metadata) {
  if (!['server', 'web'].includes(workspace)) fail('SBOM workspace is unsupported');
  if (source?.bomFormat !== 'CycloneDX' || source?.specVersion !== '1.5') {
    fail('SBOM must be CycloneDX 1.5 JSON');
  }
  const sbom = JSON.parse(JSON.stringify(source));
  if (!sbom.metadata || typeof sbom.metadata !== 'object' || Array.isArray(sbom.metadata)) sbom.metadata = {};
  const existing = Array.isArray(sbom.metadata.properties)
    ? sbom.metadata.properties.filter(item => !TRACEABILITY_PROPERTIES.some(key => item?.name === `chengye.${key}`))
    : [];
  const traceability = { ...metadataRecord(metadata), workspace };
  sbom.metadata.properties = [
    ...existing,
    ...TRACEABILITY_PROPERTIES.map(key => ({ name: `chengye.${key}`, value: traceability[key] })),
  ];
  return atomicJson(path.join(outputDirectory, 'sbom', `${workspace}.cdx.json`), sbom);
}
