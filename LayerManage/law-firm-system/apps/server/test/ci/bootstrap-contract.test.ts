import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkBootstrapContract } from '../../scripts/ci/check-bootstrap-contract';

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const projectRoot = path.join(repositoryRoot, 'LayerManage', 'law-firm-system');

const validRootScripts = {
  'db:deploy': 'npm --prefix apps/server run db:deploy',
  'system:bootstrap': 'npm --prefix apps/server run system:bootstrap',
  'super-admin:recover': 'npm --prefix apps/server run super-admin:recover',
  'check:bootstrap': 'npm --prefix apps/server run check:bootstrap',
  verify: 'npm run lint && npm run typecheck && npm run test && npm --prefix apps/server run check:baseline && npm run check:bootstrap && npm run build',
};

const validServerScripts = {
  'system:bootstrap': 'tsx scripts/system/bootstrap-system.ts',
  'super-admin:recover': 'tsx scripts/system/recover-super-admin.ts',
  'check:bootstrap': 'tsx scripts/ci/check-bootstrap-contract.ts',
};

interface ProjectFixture {
  projectRoot: string;
  serverRoot: string;
  write(relativePath: string, contents: string): void;
}

function createProjectFixture(): ProjectFixture {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-contract-'));
  const serverRoot = path.join(fixtureRoot, 'apps', 'server');

  const write = (relativePath: string, contents: string) => {
    const filePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  };

  write('package.json', JSON.stringify({ scripts: validRootScripts }));
  write('apps/server/package.json', JSON.stringify({ scripts: validServerScripts }));
  write('apps/server/prisma/schema.prisma', 'model SystemInitialization {\n  id String @id\n}\n');
  write('apps/server/app/router.ts', "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);\n");
  write('apps/server/.env.example', 'ALLOW_SUPER_ADMIN_RECOVERY=false\n');
  write('apps/server/app.ts', 'export default class AppBootHook {}\n');
  write('apps/server/server-entry.js', "require('./dist/app');\n");
  write('apps/server/config/config.default.ts', 'export default {};\n');
  write('apps/server/scripts/system/bootstrap-system.ts', 'runInteractiveBootstrap();\n');
  write('apps/server/scripts/system/recover-super-admin.ts', 'runInteractiveRecovery();\n');
  write('apps/server/scripts/system/system-cli.ts', 'export function hiddenPrompt() {}\n');

  return { projectRoot: fixtureRoot, serverRoot, write };
}

function withFixture(run: (fixture: ProjectFixture) => void): void {
  const fixture = createProjectFixture();
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
}

function assertOnlyIssue(mutate: (fixture: ProjectFixture) => void, expectedIssue: string): void {
  withFixture(fixture => {
    mutate(fixture);
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [expectedIssue]);
  });
}

test('the repository satisfies the bootstrap contract', () => {
  assert.deepEqual(checkBootstrapContract(projectRoot), []);
});

test('a complete fixture satisfies the bootstrap contract', () => {
  withFixture(fixture => {
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('requires the exact root bootstrap command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'system:bootstrap': 'node bootstrap.js' },
  })), 'root bootstrap command is missing or changed');
});

test('requires the exact root recovery command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'super-admin:recover': 'node recover.js' },
  })), 'root recovery command is missing or changed');
});

test('requires the exact root bootstrap checker command', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: { ...validRootScripts, 'check:bootstrap': 'tsx another-checker.ts' },
  })), 'root bootstrap checker command is missing or changed');
});

test('requires root verify to run the baseline checker before the bootstrap checker', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: {
      ...validRootScripts,
      verify: 'npm run lint && npm run check:bootstrap && npm --prefix apps/server run check:baseline && npm run build',
    },
  })), 'root verify must run check:baseline before check:bootstrap');
});

test('rejects echo-only baseline and bootstrap mentions in root verify', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: {
      ...validRootScripts,
      verify: 'npm run lint && echo check:baseline && echo check:bootstrap && npm run build',
    },
  })), 'root verify must run check:baseline before check:bootstrap');
});

test('rejects extra verify commands even when required commands remain ordered', () => {
  assertOnlyIssue(fixture => fixture.write('package.json', JSON.stringify({
    scripts: {
      ...validRootScripts,
      verify: `${validRootScripts.verify} && echo done`,
    },
  })), 'root verify must run check:baseline before check:bootstrap');
});

test('requires the exact server bootstrap command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'system:bootstrap': 'tsx scripts/system/another-bootstrap.ts' },
  })), 'server bootstrap command is missing or changed');
});

test('requires the exact server recovery command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'super-admin:recover': 'tsx scripts/system/another-recovery.ts' },
  })), 'server recovery command is missing or changed');
});

test('requires the exact server bootstrap checker command', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/package.json', JSON.stringify({
    scripts: { ...validServerScripts, 'check:bootstrap': 'tsx scripts/ci/another-checker.ts' },
  })), 'server bootstrap checker command is missing or changed');
});

test('requires the SystemInitialization model', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/prisma/schema.prisma', ''), 'SystemInitialization model is missing');
});

test('a schema comment cannot satisfy the SystemInitialization model requirement', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/prisma/schema.prisma',
    '// model SystemInitialization { id String @id }\n',
  ), 'SystemInitialization model is missing');
});

test('requires the recovery example gate to default to false', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/.env.example', 'ALLOW_SUPER_ADMIN_RECOVERY=true\n'), 'recovery gate example must default to false');
});

test('an env comment cannot satisfy the disabled recovery default', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/.env.example',
    '# ALLOW_SUPER_ADMIN_RECOVERY=false\nALLOW_SUPER_ADMIN_RECOVERY=true\n',
  ), 'recovery gate example must default to false');
});

test('requires the forced password change route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', ''), 'forced password change route is missing');
});

test('a router comment cannot satisfy the forced password change route', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/app/router.ts',
    "// router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);\n",
  ), 'forced password change route is missing');
});

test('accepts bracket access for the required forced password change route', () => {
  withFixture(fixture => {
    fixture.write('apps/server/app/router.ts', "router['post']('/api/v1/auth/password/forced-change', controller.auth.forcedChange);\n");
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('rejects a forced-change route suffix spoof', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/app/router.ts',
    "router.post('/api/v1/auth/password/forced-change-not-real', controller.auth.forcedChange);\n",
  ), 'forced password change route is missing');
});

test('rejects an HTTP bootstrap route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    "router.post('/system/bootstrap', controller.system.bootstrap);",
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects an HTTP recovery route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    "router.patch('/admin/recover', controller.admin.recover);",
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects a multiline HTTP bootstrap route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    'router.post(',
    "  '/system/bootstrap',",
    '  controller.system.bootstrap,',
    ');',
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
  test(`rejects a router.${method} recovery route`, () => {
    assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
      "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
      `router.${method}('/system/recover', controller.system.recover);`,
    ].join('\n')), 'HTTP bootstrap or recovery route exists');
  });
}

test('rejects a folded bracket-access router route', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    "router['all'](",
    "  '/system/bootstrap',",
    '  controller.system.bootstrap,',
    ');',
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects a forbidden route path resolved from a local const', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    "const recoveryPath = '/system/recover';",
    'router.post(recoveryPath, controller.system.recover);',
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('rejects an unresolved dynamic router path conservatively', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app/router.ts', [
    "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
    'const systemPath = resolveSystemPath();',
    'router.all(systemPath, controller.system.dispatch);',
  ].join('\n')), 'HTTP bootstrap or recovery route exists');
});

test('ignores forbidden route text that exists only in comments and strings', () => {
  withFixture(fixture => {
    fixture.write('apps/server/app/router.ts', [
      "router.post('/api/v1/auth/password/forced-change', controller.auth.forcedChange);",
      "// router.all('/system/recover', controller.system.recover);",
      "const example = \"router.post('/system/bootstrap')\";",
    ].join('\n'));
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('rejects bootstrap service invocation from startup', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app.ts', 'new SystemBootstrapService().execute();\n'), 'startup invokes system commands');
});

test('ignores startup comments, arbitrary strings, and import-only service mentions', () => {
  withFixture(fixture => {
    fixture.write('apps/server/app.ts', [
      "import { SystemBootstrapService } from './application/system/system-bootstrap-service';",
      '// new SuperAdminRecoveryService().execute();',
      "const diagnostic = 'SystemBootstrapService system:bootstrap super-admin:recover';",
      'export { SystemBootstrapService, diagnostic };',
    ].join('\n'));
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('rejects an actual recovery service execution from startup configuration', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/config/config.default.ts',
    'new SuperAdminRecoveryService().execute();\n',
  ), 'startup invokes system commands');
});

test('rejects an actual bootstrap call from startup entry', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/server-entry.js',
    'runSystemBootstrap();\n',
  ), 'startup invokes system commands');
});

test('rejects invocation through an aliased bootstrap service import', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/app.ts', [
    "import { SystemBootstrapService as Bootstrap } from './application/system/system-bootstrap-service';",
    'new Bootstrap().execute();',
  ].join('\n')), 'startup invokes system commands');
});

for (const invocation of [
  "run('system:bootstrap');",
  'dispatch(`super-admin:recover`);',
  "exec('npm run system:bootstrap');",
  "spawn('npm --silent run super-admin:recover');",
  "spawn('npm', ['run', 'system:bootstrap']);",
  "new Command('npm run super-admin:recover');",
]) {
  test(`rejects startup dispatcher or process invocation ${invocation}`, () => {
    assertOnlyIssue(fixture => fixture.write(
      'apps/server/app.ts',
      `${invocation}\n`,
    ), 'startup invokes system commands');
  });
}

test('allows startup command names in comments, imports, arbitrary strings, and output calls', () => {
  withFixture(fixture => {
    fixture.write('apps/server/app.ts', [
      "import { run as importedRun } from './runner';",
      '// run(`system:bootstrap`);',
      "const example = 'npm run super-admin:recover';",
      "logger.info('npm run system:bootstrap');",
      "console.log('super-admin:recover');",
      "dispatch('documentation for system:bootstrap');",
      'export { importedRun, example };',
    ].join('\n'));
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('rejects password command-line arguments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/bootstrap-system.ts', "process.argv.includes('--admin-password');\n"), 'CLI accepts a password argument or environment variable');
});

test('rejects temporary password command-line arguments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/recover-super-admin.ts', 'parseOption(\'--temporary-password\');\n'), 'CLI accepts a password argument or environment variable');
});

test('rejects password environment-variable assignments in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/system-cli.ts', "const password = process.env['RECOVERY_PASSWD'];\n"), 'CLI accepts a password argument or environment variable');
});

test('rejects password environment-variable reads in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/system-cli.ts', 'const password = process.env.ADMIN_PASSWORD;\n'), 'CLI accepts a password argument or environment variable');
});

test('rejects prefixed PWD environment-variable reads in nested system CLI sources', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/helpers/credentials.ts',
    'export const password = process.env.SERVICE_PWD;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects destructured password environment-variable reads', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const { BOOTSTRAP_PASSWORD } = process.env;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects aliased destructured password environment-variable reads', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const { ADMIN_PASSWORD: suppliedSecret } = process.env;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a process environment alias password read', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const runtimeEnv = process.env;\nconst password = runtimeEnv.ADMIN_PASSWORD;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a destructured password read through a process environment alias', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const runtimeEnv = process.env;\nconst { RECOVERY_PASSWD: supplied } = runtimeEnv;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a function parameter defaulted to process environment and reading a password', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'function loadSecret(env = process.env) { return env.ADMIN_PASSWORD; }\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a method parameter defaulted to process environment and reading a password', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'class Loader { load(env = process.env) { return env.SERVICE_PWD; } }\n',
  ), 'CLI accepts a password argument or environment variable');
});

for (const optionSpec of [
  '--admin-password <value>',
  '--recovery-passwd <value>',
  '--temporary-pwd <value>',
]) {
  test(`rejects Commander password option spec ${optionSpec}`, () => {
    assertOnlyIssue(fixture => fixture.write(
      'apps/server/scripts/system/system-cli.ts',
      `program.requiredOption('${optionSpec}');\n`,
    ), 'CLI accepts a password argument or environment variable');
  });
}

for (const [optionKey, importLine, parserName] of [
  ['password', "import { parseArgs } from 'node:util';", 'parseArgs'],
  ['adminPassword', "import { parseArgs as parseCliArgs } from 'node:util';", 'parseCliArgs'],
] as const) {
  test(`rejects node:util parseArgs password option key ${optionKey}`, () => {
    assertOnlyIssue(fixture => fixture.write(
      'apps/server/scripts/system/system-cli.ts',
      `${importLine}\n${parserName}({ options: { ${optionKey}: { type: 'string' } } });\n`,
    ), 'CLI accepts a password argument or environment variable');
  });
}

for (const [parser, optionName] of [
  ['yargs.option', 'password'],
  ['program.option', 'admin-password'],
  ['yargs.option', 'passwd'],
  ['program.option', 'pwd'],
  ['program.requiredOption', 'recovery_passwd'],
  ['yargs.option', 'temporaryPwd'],
] as const) {
  test(`rejects parser option name ${optionName}`, () => {
    assertOnlyIssue(fixture => fixture.write(
      'apps/server/scripts/system/system-cli.ts',
      `${parser}('${optionName}', { type: 'string' });\n`,
    ), 'CLI accepts a password argument or environment variable');
  });
}

test('rejects a parser result assigned to a password-ish variable', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    "const parsed = parseArgs({ options: { secret: { type: 'string' } } });\nconst recoveryPassword = parsed.values.secret;\n",
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects parser result destructuring of a password-ish property', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const { adminPassword: supplied } = program.opts();\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a Yargs argv result feeding a password-ish variable', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const parsed = yargs.argv;\nconst temporaryPassword = parsed.secret;\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects positional argv assigned to a password variable', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const temporaryPassword = process.argv[2];\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a password derived through a process argv alias', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'const cliArgs = process.argv.slice(2);\nconst recoveryPassword = cliArgs[0];\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a password parameter defaulted from positional process argv', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    'function run(recoveryPassword = process.argv[2]) { return recoveryPassword; }\n',
  ), 'CLI accepts a password argument or environment variable');
});

test('rejects a literal default password without flagging policy identifiers', () => {
  assertOnlyIssue(fixture => fixture.write(
    'apps/server/scripts/system/system-cli.ts',
    "const recoveryPassword = 'placeholder';\n",
  ), 'CLI contains default credentials');
});

test('ignores password policy and error identifiers without a password source', () => {
  withFixture(fixture => {
    fixture.write('apps/server/scripts/system/system-cli.ts', [
      "const PASSWORD_INVALID = 'PASSWORD_INVALID';",
      'function validatePasswordPolicy() { return PASSWORD_INVALID; }',
      '// process.env.ADMIN_PASSWORD and --password are forbidden examples only.',
    ].join('\n'));
    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), []);
  });
});

test('rejects default administrator credentials in system CLIs', () => {
  assertOnlyIssue(fixture => fixture.write('apps/server/scripts/system/bootstrap-system.ts', "const credentials = 'admin / 123456';\n"), 'CLI contains default credentials');
});

test('missing manifests fail safely with deterministic issues', () => {
  withFixture(fixture => {
    fs.rmSync(path.join(fixture.projectRoot, 'package.json'));
    fs.rmSync(path.join(fixture.serverRoot, 'package.json'));

    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [
      'root package manifest is missing',
      'server package manifest is missing',
      'root bootstrap command is missing or changed',
      'root recovery command is missing or changed',
      'root bootstrap checker command is missing or changed',
      'root verify must run check:baseline before check:bootstrap',
      'server bootstrap command is missing or changed',
      'server recovery command is missing or changed',
      'server bootstrap checker command is missing or changed',
    ]);
  });
});

test('malformed manifests fail safely with deterministic useful issues', () => {
  withFixture(fixture => {
    fixture.write('package.json', '{not-json');
    fixture.write('apps/server/package.json', '[]');

    assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [
      'root package manifest is invalid JSON',
      'server package manifest must contain a JSON object',
      'root bootstrap command is missing or changed',
      'root recovery command is missing or changed',
      'root bootstrap checker command is missing or changed',
      'root verify must run check:baseline before check:bootstrap',
      'server bootstrap command is missing or changed',
      'server recovery command is missing or changed',
      'server bootstrap checker command is missing or changed',
    ]);
  });
});

const consumedScripts = [
  { manifest: 'package.json', scope: 'root', name: 'system:bootstrap', issue: 'root bootstrap command is missing or changed' },
  { manifest: 'package.json', scope: 'root', name: 'super-admin:recover', issue: 'root recovery command is missing or changed' },
  { manifest: 'package.json', scope: 'root', name: 'check:bootstrap', issue: 'root bootstrap checker command is missing or changed' },
  { manifest: 'package.json', scope: 'root', name: 'verify', issue: 'root verify must run check:baseline before check:bootstrap' },
  { manifest: 'apps/server/package.json', scope: 'server', name: 'system:bootstrap', issue: 'server bootstrap command is missing or changed' },
  { manifest: 'apps/server/package.json', scope: 'server', name: 'super-admin:recover', issue: 'server recovery command is missing or changed' },
  { manifest: 'apps/server/package.json', scope: 'server', name: 'check:bootstrap', issue: 'server bootstrap checker command is missing or changed' },
] as const;

for (const script of consumedScripts) {
  for (const [kind, value] of [
    ['null', null],
    ['array', []],
    ['number', 7],
    ['object', { command: 'spoof' }],
  ] as const) {
    test(`${script.scope} ${script.name} rejects a ${kind} script value without throwing`, () => {
      withFixture(fixture => {
        const scripts = script.scope === 'root' ? validRootScripts : validServerScripts;
        fixture.write(script.manifest, JSON.stringify({ scripts: { ...scripts, [script.name]: value } }));
        assert.deepEqual(checkBootstrapContract(fixture.projectRoot), [
          `${script.scope} ${script.name} script must be a string`,
          script.issue,
        ]);
      });
    });
  }
}
