import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  checkWorkflowContract,
  extractWorkflowSteps,
} from '../../scripts/ci/workflow-contract';

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const projectRoot = path.join(repositoryRoot, 'LayerManage', 'law-firm-system');

test('Node baseline supports the locked toolchain and stays aligned across CI metadata', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const nvmVersion = fs.readFileSync(path.join(repositoryRoot, '.nvmrc'), 'utf8').trim();
  const rootManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const rootLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const serverManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'server', 'package.json'), 'utf8'));
  const serverLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'server', 'package-lock.json'), 'utf8'));
  const webManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'web', 'package.json'), 'utf8'));
  const webLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'web', 'package-lock.json'), 'utf8'));

  assert.equal(nvmVersion, '22.14.0');
  assert.equal(rootManifest.engines.node, '>=22.14.0 <23');
  assert.equal(rootLock.packages[''].engines.node, rootManifest.engines.node);
  assert.equal(serverManifest.engines.node, rootManifest.engines.node);
  assert.equal(serverLock.packages[''].engines.node, serverManifest.engines.node);
  assert.equal(webManifest.engines.node, rootManifest.engines.node);
  assert.equal(webLock.packages[''].engines.node, webManifest.engines.node);
  assert.match(workflow, /node-version: '22\.14\.0'/);
});

test('CI compares the migrated PostgreSQL database with the canonical Prisma schema', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /working-directory: LayerManage\/law-firm-system\/apps\/server\s+run: npx prisma migrate diff --from-url "\$DATABASE_URL" --to-schema-datamodel prisma\/schema\.prisma --exit-code/);
});

function workflowFixture(acceptanceSteps: string, extra = ''): string {
  return `name: fixture
jobs:
  verify:
    runs-on: ubuntu-latest
    env:
      ALLOW_SUPER_ADMIN_RECOVERY: 'false'
    steps:
${acceptanceSteps}${extra}
`;
}

const validAcceptanceSteps = `      - name: migrate
        working-directory: LayerManage/law-firm-system/apps/server
        run: npx prisma migrate deploy
      - name: assert initial
        working-directory: LayerManage/law-firm-system
        run: npm run db:assert-empty
      - name: verify
        working-directory: LayerManage/law-firm-system
        run: npm run verify
      - name: reset
        working-directory: LayerManage/law-firm-system
        run: npm run db:reset:test
      - name: assert final
        working-directory: LayerManage/law-firm-system
        run: npm run db:assert-empty
      - name: drift
        run: git diff --exit-code
`;

test('workflow extractor reads literal and folded run blocks without treating comments as steps', () => {
  const steps = extractWorkflowSteps(workflowFixture(`${validAcceptanceSteps}      - name: literal
        run: |
          npm run lint
          npm run typecheck
      - name: folded
        run: >-
          npm run
          build
      # - run: npm run system:bootstrap
`));

  assert.equal(steps.at(-2)?.run, 'npm run lint\nnpm run typecheck\n');
  assert.equal(steps.at(-1)?.run, 'npm run build');
});

test('workflow contract accepts the exact verify-job acceptance sequence', () => {
  assert.deepEqual(checkWorkflowContract(workflowFixture(validAcceptanceSteps)), []);
});

test('workflow comments, unrelated strings, and wrong-job commands cannot satisfy positives', () => {
  const missingVerify = validAcceptanceSteps.replace('        run: npm run verify\n', '        run: echo "npm run verify"\n');
  const spoof = `
  other:
    steps:
      - run: npm run verify
      # run: npm run verify
      - run: echo "npx prisma migrate deploy"
`;

  assert.deepEqual(checkWorkflowContract(workflowFixture(missingVerify, spoof)), [
    'CI verify job bootstrap acceptance steps must match exact commands, directories, order, and uniqueness',
  ]);
});

test('workflow contract rejects wrong directories, wrong order, and duplicate acceptance steps', () => {
  const wrongDirectory = validAcceptanceSteps.replace(
    '        working-directory: LayerManage/law-firm-system/apps/server',
    '        working-directory: LayerManage/law-firm-system',
  );
  const wrongOrder = validAcceptanceSteps.replace(
    / {6}- name: verify[\s\S]*?run: npm run verify\n {6}- name: reset[\s\S]*?run: npm run db:reset:test\n/,
    `      - name: reset
        working-directory: LayerManage/law-firm-system
        run: npm run db:reset:test
      - name: verify
        working-directory: LayerManage/law-firm-system
        run: npm run verify
`,
  );
  const duplicate = `${validAcceptanceSteps}      - name: duplicate drift
        run: git diff --exit-code
`;

  for (const fixture of [wrongDirectory, wrongOrder, duplicate]) {
    assert.deepEqual(checkWorkflowContract(workflowFixture(fixture)), [
      'CI verify job bootstrap acceptance steps must match exact commands, directories, order, and uniqueness',
    ]);
  }
});

test('workflow contract inspects multiline literal commands for interactive bootstrap and recovery', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden bootstrap
        run: |
          npm run lint
          npm run system:bootstrap
      - name: forbidden recovery
        run: |
          npm run \
          super-admin:recover
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract inspects inline literal run blocks and assignment-prefixed commands', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - run: |
          NODE_ENV=test npm --prefix LayerManage/law-firm-system run system:bootstrap
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract inspects folded blocks and active YAML for recovery enablement', () => {
  const folded = workflowFixture(`${validAcceptanceSteps}      - name: forbidden gate
        run: >-
          export ALLOW_SUPER_ADMIN_RECOVERY=true
          && npm run verify
`);
  const activeYaml = workflowFixture(validAcceptanceSteps).replace(
    "ALLOW_SUPER_ADMIN_RECOVERY: 'false'",
    'ALLOW_SUPER_ADMIN_RECOVERY: true',
  );

  assert.deepEqual(checkWorkflowContract(folded), [
    'CI must not enable ALLOW_SUPER_ADMIN_RECOVERY',
  ]);
  assert.deepEqual(checkWorkflowContract(activeYaml), [
    'CI must not enable ALLOW_SUPER_ADMIN_RECOVERY',
  ]);
});

test('workflow contract accepts quoted recovery keys only when their value is literal false', () => {
  const quotedFalse = workflowFixture(validAcceptanceSteps).replace(
    "ALLOW_SUPER_ADMIN_RECOVERY: 'false'",
    "'ALLOW_SUPER_ADMIN_RECOVERY': 'false'",
  );

  assert.deepEqual(checkWorkflowContract(quotedFalse), []);
});

test('workflow contract rejects recovery enablement in an inline flow env map', () => {
  const flowMap = workflowFixture(validAcceptanceSteps).replace(
    "env:\n      ALLOW_SUPER_ADMIN_RECOVERY: 'false'",
    'env: { ALLOW_SUPER_ADMIN_RECOVERY: true }',
  );

  assert.deepEqual(checkWorkflowContract(flowMap), [
    'CI must not enable ALLOW_SUPER_ADMIN_RECOVERY',
  ]);
});

test('workflow contract rejects quoted true and expression recovery env values', () => {
  const quotedTrue = workflowFixture(validAcceptanceSteps).replace("'false'", "'true'");
  const expression = workflowFixture(validAcceptanceSteps).replace(
    "'false'",
    '${{ vars.ALLOW_SUPER_ADMIN_RECOVERY }}',
  );

  for (const fixture of [quotedTrue, expression]) {
    assert.deepEqual(checkWorkflowContract(fixture), [
      'CI must not enable ALLOW_SUPER_ADMIN_RECOVERY',
    ]);
  }
});

test('workflow contract checks recovery env at workflow, job, and step scopes', () => {
  const fixture = `name: fixture
env: { ALLOW_SUPER_ADMIN_RECOVERY: false }
jobs:
  verify:
    env: { ALLOW_SUPER_ADMIN_RECOVERY: 'false' }
    steps:
${validAcceptanceSteps}      - name: forbidden step env
        env: { 'ALLOW_SUPER_ADMIN_RECOVERY': '\${{ vars.RECOVERY }}' }
        run: echo ready
`;

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not enable ALLOW_SUPER_ADMIN_RECOVERY',
  ]);
});

for (const [name, run] of [
  ['Bash pipe', 'echo ready | npm run system:bootstrap'],
  ['option after run', 'npm run --silent system:bootstrap'],
  ['option before run', 'npm --silent run super-admin:recover'],
  ['PowerShell invocation operator', '& npm.cmd --prefix LayerManage/law-firm-system run system:bootstrap'],
] as const) {
  test(`workflow contract rejects interactive invocation through ${name}`, () => {
    const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden
        run: ${JSON.stringify(run)}
`);

    assert.deepEqual(checkWorkflowContract(fixture), [
      'CI must not invoke interactive bootstrap or recovery commands',
    ]);
  });
}

for (const [name, run] of [
  ['command wrapper', 'command npm run system:bootstrap'],
  ['quoted bash command', "bash -c 'npm run super-admin:recover'"],
  ['quoted sh login command', 'sh -lc "npm --silent run system:bootstrap"'],
  ['PowerShell command wrapper', 'pwsh -Command "npm run super-admin:recover"'],
] as const) {
  test(`workflow contract rejects interactive invocation through ${name}`, () => {
    const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden wrapper
        run: ${JSON.stringify(run)}
`);

    assert.deepEqual(checkWorkflowContract(fixture), [
      'CI must not invoke interactive bootstrap or recovery commands',
    ]);
  });
}

test('workflow contract rejects PowerShell Start-Process npm argument lists', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden process
        shell: pwsh
        run: Start-Process 'npm.cmd' -ArgumentList 'run','system:bootstrap'
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract rejects Start-Process argument lists containing npm options', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden process options
        shell: pwsh
        run: Start-Process npm.cmd -ArgumentList '--prefix','LayerManage/law-firm-system','run','super-admin:recover'
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract recursively inspects env and zsh wrappers', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden nested wrapper
        run: env NODE_ENV=test zsh -c 'npm run system:bootstrap'
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract fails closed on an exact interactive script executable argument', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: forbidden custom runner
        run: custom-runner system:bootstrap
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract permits wrapped command text in output-only commands', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: harmless output
        shell: pwsh
        run: |
          echo "bash -c 'npm run system:bootstrap'"
          Write-Output "Start-Process npm.cmd -ArgumentList run,super-admin:recover"
`);

  assert.deepEqual(checkWorkflowContract(fixture), []);
});

test('workflow contract rejects interactive commands in parsed literal and folded YAML scalars', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      - name: literal
        run: |
          echo ready;
          npm --silent run super-admin:recover
      - name: folded
        run: >-
          Write-Output ready |
          npm.cmd run --silent system:bootstrap
`);

  assert.deepEqual(checkWorkflowContract(fixture), [
    'CI must not invoke interactive bootstrap or recovery commands',
  ]);
});

test('workflow contract ignores forbidden command and recovery spoof text', () => {
  const fixture = workflowFixture(`${validAcceptanceSteps}      # run: npm run system:bootstrap
      - name: harmless output
        run: |
          # npm run super-admin:recover
          echo "npm run system:bootstrap"
          echo "ALLOW_SUPER_ADMIN_RECOVERY=true"
`);

  assert.deepEqual(checkWorkflowContract(fixture), []);
});

test('CI preserves bootstrap verification and clean-database acceptance order', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.deepEqual(checkWorkflowContract(workflow), []);
});

test('the verification runner serializes backend files that share the test database', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'apps', 'server', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const runnerPath = path.join(projectRoot, 'apps', 'server', 'scripts', 'ci', 'run-node-tests-serial.ts');

  assert.equal(manifest.scripts['test:unit'], 'tsx scripts/ci/run-node-tests-serial.ts');
  assert.ok(fs.existsSync(runnerPath), 'serial backend test runner is missing');
  const runner = fs.readFileSync(runnerPath, 'utf8');
  assert.match(runner, /discoverBackendTests/);
  assert.match(runner, /['"]--test-concurrency=1['"]/);
  assert.match(runner, /['"]--test-force-exit['"]/);
});

test('root verification uses the standard web test timeout', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  assert.equal(manifest.scripts.test, 'npm --prefix apps/server run test:unit && npm --prefix apps/web run test');
  assert.equal(manifest.scripts['test:all'], 'npm --prefix apps/server run test:unit && npm --prefix apps/web run test');
});

test('CI runs Gitleaks from an immutable scanner image with repository config', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const config = fs.readFileSync(path.join(repositoryRoot, '.gitleaks.toml'), 'utf8');
  assert.match(workflow, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:[0-9a-f]{64}/);
  assert.match(workflow, /detect --source=\/repo --config=\/repo\/\.gitleaks\.toml --no-banner --redact --no-git/);
  assert.match(config, /SPEC-001 documented local and CI placeholders/);
  assert.match(config, /useDefault = true/);
  assert.match(config, /regexTarget\s*=\s*['"]secret['"]/);
  for (const placeholder of [
    'chengye_local_only',
    'chengye_test_local_only',
    '01234567890123456789012345678901',
    'first-32-character-application-key',
    'second-32-character-app-key',
    'replace_with_at_least_32_random_characters',
    'replace_with_first_application_key',
    'replace_with_second_application_key',
  ]) {
    assert.match(config, new RegExp(`\\^${placeholder}\\$`));
  }
  assert.doesNotMatch(config, /stopwords|paths\s*=/i);
});

test('CI runs the pinned-image Gitleaks semantic fixtures without weakening the repository scan', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const semanticScript = fs.readFileSync(path.resolve('scripts/ci/check-gitleaks-semantics.js'), 'utf8');

  assert.equal(manifest.scripts['check:gitleaks-semantics'], 'node scripts/ci/check-gitleaks-semantics.js');
  assert.match(workflow, /name: Prove Gitleaks placeholder semantics[\s\S]*npm --prefix LayerManage\/law-firm-system\/apps\/server run check:gitleaks-semantics/);
  assert.match(semanticScript, /ghcr\.io\/gitleaks\/gitleaks:v8\.30\.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f/);
  assert.match(semanticScript, /allowed[^\n]+status[^\n]+===?\s*0|status[^\n]+!==?\s*0/);
  assert.match(semanticScript, /detected[^\n]+status[^\n]+===?\s*1|status[^\n]+!==?\s*1/);
  assert.equal((workflow.match(/detect --source=\/repo --config=\/repo\/\.gitleaks\.toml --no-banner --redact --no-git/g) ?? []).length, 1);
});

test('CI continuously exercises the real Windows ZIP builder', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /windows-package:\s+[\s\S]*?runs-on: windows-latest/);
  assert.match(workflow, /windows-package:[\s\S]*?node-version: '22\.14\.0'/);
  assert.match(workflow, /windows-package:[\s\S]*?working-directory: LayerManage\/law-firm-system\/apps\/server\s+run: npm ci/);
  assert.match(workflow, /windows-package:[\s\S]*?npx tsx --test --test-force-exit test\/build\/distribution-inputs\.test\.ts/);
});
