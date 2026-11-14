import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

type BuildPkg = (options: {
  serverRoot: string;
  outputDirectory: string;
  runCommand: (command: string, options: { cwd: string; stdio: 'inherit' }) => void;
}) => { engineFile: string; outputFile: string; runDirectory: string; staticDirectory: string };

const requireCjs = createRequire(__filename);

function loadBuildPkg(): BuildPkg {
  return (requireCjs('../../scripts/lib/pkg-build') as { buildPkg: BuildPkg }).buildPkg;
}

function createFixture(): { outputDirectory: string; serverRoot: string; webRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-build-'));
  const serverRoot = path.join(root, 'apps', 'server');
  const webRoot = path.join(root, 'apps', 'web');
  const outputDirectory = path.join(root, 'apps', 'dist');
  const generatedClient = path.join(serverRoot, 'node_modules', '.prisma', 'client');
  fs.mkdirSync(generatedClient, { recursive: true });
  fs.writeFileSync(path.join(generatedClient, 'query_engine-windows.dll.node'), 'generated engine');
  fs.mkdirSync(webRoot, { recursive: true });
  return { outputDirectory, serverRoot, webRoot };
}

test('pkg build creates frontend assets from a checkout with no server/public and packages only the fresh dist copy', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));
  const commands: Array<{ command: string; cwd: string }> = [];

  assert.equal(fs.existsSync(path.join(fixture.serverRoot, 'public')), false);

  const result = loadBuildPkg()({
    ...fixture,
    runCommand(command, options) {
      commands.push({ command, cwd: options.cwd });
      if (command === 'npm run build' && options.cwd === fixture.webRoot) {
        const staticDirectory = path.join(fixture.webRoot, 'dist');
        fs.mkdirSync(staticDirectory, { recursive: true });
        fs.writeFileSync(path.join(staticDirectory, 'index.html'), 'fresh web build');
      }
      if (command === 'npm run build' && options.cwd === fixture.serverRoot) {
        fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
      }
      if (command.startsWith('pkg .')) {
        assert.equal(
          fs.readFileSync(path.join(fixture.serverRoot, 'dist', 'public', 'index.html'), 'utf8'),
          'fresh web build',
        );
        assert.equal(fs.existsSync(path.join(fixture.serverRoot, 'public')), false);
        const outputFile = path.join(fixture.outputDirectory, 'law-firm-system', 'law-firm-system.exe');
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, 'packaged executable');
      }
    },
  });

  assert.deepEqual(commands, [
    { command: 'npm run build', cwd: fixture.webRoot },
    { command: 'npm run build', cwd: fixture.serverRoot },
    {
      command: `pkg . --targets node22-win-x64 --options no-experimental-require-module --output "${result.outputFile}"`,
      cwd: fixture.serverRoot,
    },
  ]);
  assert.equal(
    commands[2].command,
    `pkg . --targets node22-win-x64 --options no-experimental-require-module --output "${result.outputFile}"`,
  );
  assert.equal(result.outputFile, path.join(fixture.outputDirectory, 'law-firm-system', 'law-firm-system.exe'));
  assert.equal(
    result.engineFile,
    path.join(fixture.outputDirectory, 'law-firm-system', 'prisma-engine', 'query_engine-windows.dll.node'),
  );
  assert.ok(fs.statSync(result.outputFile).size > 0);
  assert.ok(fs.statSync(result.engineFile).size > 0);
  assert.equal(result.staticDirectory, path.join(fixture.outputDirectory, 'law-firm-system', 'public'));
  assert.equal(result.runDirectory, path.join(fixture.outputDirectory, 'law-firm-system', 'run'));
  assert.equal(fs.statSync(result.runDirectory).isDirectory(), true);
  assert.equal(
    fs.readFileSync(path.join(result.staticDirectory, 'index.html'), 'utf8'),
    'fresh web build',
  );
});

test('pkg build cleans package output when the fresh web build directory is missing', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));

  assert.throws(
    () => loadBuildPkg()({
      ...fixture,
      runCommand(command, options) {
        if (command === 'npm run build' && options.cwd === fixture.serverRoot) {
          fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
        }
        if (command.startsWith('pkg .')) {
          const outputFile = path.join(fixture.outputDirectory, 'law-firm-system', 'law-firm-system.exe');
          fs.mkdirSync(path.dirname(outputFile), { recursive: true });
          fs.writeFileSync(outputFile, 'packaged executable');
        }
      },
    }),
    /Web build output is missing or not a directory/,
  );

  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test('pkg build rejects forbidden files copied from the fresh web build and cleans every partial output', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));
  let pkgWasCalled = false;

  assert.throws(
    () => loadBuildPkg()({
      ...fixture,
      runCommand(command, options) {
        if (command === 'npm run build' && options.cwd === fixture.webRoot) {
          fs.mkdirSync(path.join(fixture.webRoot, 'dist'), { recursive: true });
          fs.writeFileSync(path.join(fixture.webRoot, 'dist', 'index.html'), 'fresh web build');
          fs.writeFileSync(path.join(fixture.webRoot, 'dist', '.env.production'), 'FORBIDDEN_WEB_FIXTURE');
        }
        if (command === 'npm run build' && options.cwd === fixture.serverRoot) {
          fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
        }
        if (command.startsWith('pkg .')) pkgWasCalled = true;
      },
    }),
    /Forbidden materialized web artifacts: \.env\.production/,
  );

  assert.equal(pkgWasCalled, false);
  assert.equal(fs.existsSync(path.join(fixture.serverRoot, 'dist')), false);
  assert.equal(fs.existsSync(path.join(fixture.webRoot, 'dist')), false);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test('pkg build rejects forbidden files in the final portable tree and cleans the package output', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));

  assert.throws(
    () => loadBuildPkg()({
      ...fixture,
      runCommand(command, options) {
        if (command === 'npm run build' && options.cwd === fixture.webRoot) {
          fs.mkdirSync(path.join(fixture.webRoot, 'dist'), { recursive: true });
          fs.writeFileSync(path.join(fixture.webRoot, 'dist', 'index.html'), 'fresh web build');
        }
        if (command === 'npm run build' && options.cwd === fixture.serverRoot) {
          fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
        }
        if (command.startsWith('pkg .')) {
          const portable = path.join(fixture.outputDirectory, 'law-firm-system');
          fs.mkdirSync(portable, { recursive: true });
          fs.writeFileSync(path.join(portable, 'law-firm-system.exe'), 'packaged executable');
          fs.writeFileSync(path.join(portable, 'credentials.json'), 'FORBIDDEN_PACKAGE_FIXTURE');
        }
      },
    }),
    /Forbidden package artifacts: credentials\.json/,
  );

  assert.equal(fs.existsSync(path.join(fixture.serverRoot, 'dist')), false);
  assert.equal(fs.existsSync(path.join(fixture.webRoot, 'dist')), false);
  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});

test('pkg build removes stale output before assembly and cleans partial output after failure', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));
  const staleFile = path.join(fixture.outputDirectory, 'law-firm-system', 'stale.txt');
  fs.mkdirSync(path.dirname(staleFile), { recursive: true });
  fs.writeFileSync(staleFile, 'stale package output');

  assert.throws(
    () => loadBuildPkg()({
      ...fixture,
      runCommand(command, options) {
        if (command === 'npm run build' && options.cwd === fixture.webRoot) {
          assert.equal(fs.existsSync(staleFile), false);
          fs.mkdirSync(path.join(fixture.webRoot, 'dist'), { recursive: true });
          fs.writeFileSync(path.join(fixture.webRoot, 'dist', 'index.html'), 'fresh web build');
          return;
        }
        if (command === 'npm run build' && options.cwd === fixture.serverRoot) {
          fs.mkdirSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
          return;
        }
        fs.mkdirSync(path.join(fixture.outputDirectory, 'law-firm-system'), { recursive: true });
        fs.writeFileSync(path.join(fixture.outputDirectory, 'law-firm-system', 'partial.exe'), 'partial');
        throw new Error('pkg assembly failed');
      },
    }),
    /pkg assembly failed/,
  );

  assert.equal(fs.existsSync(fixture.outputDirectory), false);
});
