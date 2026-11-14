import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBaseline } from './policy.mjs';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const GATE_SEVERITIES = ['critical', 'high', 'moderate', 'low'];
const SCOPES = ['production', 'development'];
const BASELINE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'expected-baseline.json');

function fail(message) {
  throw new Error(message);
}

function isSevere(severity) {
  return severity === 'moderate' || severity === 'high' || severity === 'critical';
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function validateCounts(value) {
  const counts = record(value, 'audit vulnerability metadata');
  for (const key of [...SEVERITIES, 'total']) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) {
      fail(`audit vulnerability metadata.${key} must be a non-negative integer`);
    }
  }
  return counts;
}

function validateAuditReport(value) {
  const report = record(value, 'npm audit report');
  if (report.auditReportVersion !== 2) fail('npm audit report must use version 2');
  record(report.vulnerabilities, 'npm audit vulnerabilities');
  const metadata = record(report.metadata, 'npm audit metadata');
  validateCounts(metadata.vulnerabilities);
  return report;
}

export function parseAuditJson(source) {
  if (typeof source !== 'string' || source.trim().length === 0) fail('npm audit output is empty');
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail('npm audit output is not valid JSON');
  }
  return validateAuditReport(value);
}

function advisoryId(via) {
  if (typeof via.url === 'string') {
    const match = via.url.match(/\/advisories\/(GHSA-[0-9a-z-]+)(?:$|[/?#])/i);
    if (match) return match[1];
  }
  if (Number.isInteger(via.source) && via.source > 0) return `npm:${via.source}`;
  return undefined;
}

function findingKey(finding) {
  return `${finding.package}\0${finding.advisory}\0${finding.severity}`;
}

function scopeKey(finding) {
  return `${finding.package}\0${finding.advisory}`;
}

export function normalizeFindings(reportValue) {
  const report = validateAuditReport(reportValue);
  const findings = new Map();
  const traversed = new Set();
  const severeResolution = new Map();

  const resolvesSevereAdvisory = (name, visiting = new Set()) => {
    if (severeResolution.has(name)) return severeResolution.get(name);
    if (visiting.has(name)) return false;
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability || typeof vulnerability !== 'object' || Array.isArray(vulnerability)) {
      fail(`severe audit metadata cannot be tied to a concrete advisory: missing via ${name}`);
    }
    if (!Array.isArray(vulnerability.via)) fail(`audit vulnerability ${name} has invalid via data`);

    const nextVisiting = new Set(visiting).add(name);
    let resolved = false;
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        resolved = resolvesSevereAdvisory(via, nextVisiting) || resolved;
        continue;
      }
      const advisory = record(via, `audit advisory for ${name}`);
      if (!SEVERITIES.includes(advisory.severity)) {
        fail(`audit advisory for ${name} has invalid severity`);
      }
      if (!isSevere(advisory.severity)) continue;
      if (!advisoryId(advisory)
        || !((typeof advisory.name === 'string' && advisory.name.length > 0)
          || (typeof advisory.dependency === 'string' && advisory.dependency.length > 0))) {
        fail(`severe audit vulnerability ${name} cannot be tied to a concrete advisory`);
      }
      resolved = true;
    }
    severeResolution.set(name, resolved);
    return resolved;
  };

  for (const [name, value] of Object.entries(report.vulnerabilities)) {
    const vulnerability = record(value, `audit vulnerability ${name}`);
    if (!SEVERITIES.includes(vulnerability.severity)) {
      fail(`audit vulnerability ${name} has invalid severity`);
    }
    if (!Array.isArray(vulnerability.via)) fail(`audit vulnerability ${name} has invalid via data`);
    if (isSevere(vulnerability.severity) && !resolvesSevereAdvisory(name)) {
      fail(`severe audit vulnerability ${name} cannot be tied to a concrete advisory`);
    }
  }

  const visit = name => {
    if (traversed.has(name)) return;
    traversed.add(name);
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability || typeof vulnerability !== 'object' || Array.isArray(vulnerability)) return;
    if (!Array.isArray(vulnerability.via)) fail(`audit vulnerability ${name} has invalid via data`);
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(report.vulnerabilities, via)) {
          fail(`audit vulnerability ${name} references missing via: ${via}`);
        }
        visit(via);
        continue;
      }
      const advisory = record(via, `audit advisory for ${name}`);
      const id = advisoryId(advisory);
      const packageName = typeof advisory.name === 'string' && advisory.name.length > 0
        ? advisory.name
        : typeof advisory.dependency === 'string' && advisory.dependency.length > 0
          ? advisory.dependency
          : undefined;
      if (!SEVERITIES.includes(advisory.severity)) fail(`audit advisory for ${name} has invalid severity`);
      if (isSevere(advisory.severity) && (!id || !packageName)) {
        fail(`severe audit vulnerability ${name} cannot be tied to a concrete advisory`);
      }
      if (!id || !packageName) continue;
      const finding = { package: packageName, advisory: id, severity: advisory.severity };
      findings.set(findingKey(finding), finding);
    }
  };

  Object.keys(report.vulnerabilities).sort().forEach(visit);
  const result = [...findings.values()].sort((left, right) => findingKey(left).localeCompare(findingKey(right)));
  const counts = report.metadata.vulnerabilities;
  if (counts.high + counts.critical + counts.moderate > 0 && !result.some(item => isSevere(item.severity))) {
    fail('severe audit metadata cannot be tied to a concrete advisory');
  }
  return result;
}

function hasException(finding, workspace, exceptions) {
  return exceptions.some(exception => (exception.status === undefined || exception.status === 'approved')
    && exception.workspace === workspace
    && exception.scope === 'development'
    && exception.package === finding.package
    && exception.advisories.includes(finding.advisory));
}

function gateBlocks(finding, workspace, policy, exceptions) {
  const action = policy.gates[finding.scope]?.[finding.severity];
  if (action === 'block') return true;
  if (action === 'exception') return !hasException(finding, workspace, exceptions);
  return false;
}

function emptyCounts() {
  return { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
}

function summarize(findings, scope) {
  const counts = emptyCounts();
  for (const finding of findings.filter(item => item.scope === scope)) {
    counts[finding.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

function loadBaseline() {
  let source;
  try {
    source = readFileSync(BASELINE_PATH, 'utf8');
  } catch {
    fail(`expected audit baseline is missing: ${BASELINE_PATH}`);
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail('expected audit baseline is not valid JSON');
  }
  return validateBaseline(value);
}

function baselineExceeded(findings, workspace, baseline, exceptions) {
  const workspaceBaseline = baseline[workspace];
  const exempted = finding => finding.scope === 'development' && hasException(finding, workspace, exceptions);
  const excess = [];
  for (const scope of SCOPES) {
    for (const severity of GATE_SEVERITIES) {
      const expected = workspaceBaseline[scope][severity];
      const overBaseline = findings.filter(
        finding => finding.scope === scope && finding.severity === severity && !exempted(finding),
      );
      if (overBaseline.length > expected) excess.push(...overBaseline.slice(expected));
    }
  }
  return excess;
}

export function evaluateWorkspace({ workspace, productionReport, fullReport, policy, exceptions, baseline }) {
  if (!policy.workspaces.some(item => item.name === workspace)) fail(`unsupported workspace: ${workspace}`);
  const production = normalizeFindings(productionReport)
    .map(finding => ({ ...finding, scope: 'production' }));
  const productionKeys = new Set(production.map(scopeKey));
  const development = normalizeFindings(fullReport)
    .filter(finding => !productionKeys.has(scopeKey(finding)))
    .map(finding => ({ ...finding, scope: 'development' }));
  const findings = [...production, ...development];
  const blockers = findings.filter(finding => gateBlocks(finding, workspace, policy, exceptions));
  const baselineDocument = baseline === undefined ? loadBaseline() : validateBaseline(baseline);
  const baselineExcess = baselineExceeded(findings, workspace, baselineDocument, exceptions);

  return {
    workspace,
    passed: blockers.length === 0 && baselineExcess.length === 0,
    counts: {
      production: summarize(findings, 'production'),
      development: summarize(findings, 'development'),
    },
    findings,
    blockers,
    baselineExcess,
  };
}
