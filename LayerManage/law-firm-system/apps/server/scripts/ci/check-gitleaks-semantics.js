'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  materializeGitleaksSemanticFixtures,
  prefixedAndSuffixedVariants,
} = require('./gitleaks-semantic-fixtures');

const image = 'ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const repositoryRoot = path.resolve(__dirname, '../../../../../..');

function runScan(fixtures, sourceName, reportPath) {
  const args = [
    'run', '--rm',
    '-v', `${fixtures.root}:/semantic`,
    '-v', `${repositoryRoot}:/repo:ro`,
    image,
    'detect',
    `--source=/semantic/${sourceName}`,
    '--config=/repo/.gitleaks.toml',
    '--no-banner',
    '--redact',
    '--no-git',
    '--exit-code=1',
  ];
  if (reportPath) args.push('--report-format=json', `--report-path=/semantic/${reportPath}`);
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function failureDetail(result) {
  if (result.error) return result.error.message;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function main() {
  const fixtures = materializeGitleaksSemanticFixtures();
  try {
    const allowed = runScan(fixtures, 'allowed');
    if (allowed.status !== 0) throw new Error(`Exact documented placeholders were not allowed: ${failureDetail(allowed)}`);

    const reportName = 'detected-report.json';
    const detected = runScan(fixtures, 'detected', reportName);
    if (detected.status !== 1) throw new Error(`Prefixed/suffixed variants were not detected: ${failureDetail(detected)}`);

    const findings = JSON.parse(fs.readFileSync(path.join(fixtures.root, reportName), 'utf8'));
    const detectedLines = new Set(findings.map(finding => finding.StartLine));
    const missingLines = prefixedAndSuffixedVariants
      .map((_, index) => index + 1)
      .filter(line => !detectedLines.has(line));
    if (missingLines.length > 0) throw new Error(`Gitleaks missed semantic fixture lines: ${missingLines.join(', ')}`);

    console.log(`Gitleaks semantic fixtures are valid (${prefixedAndSuffixedVariants.length} variants detected).`);
  } finally {
    fs.rmSync(fixtures.root, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { main };
