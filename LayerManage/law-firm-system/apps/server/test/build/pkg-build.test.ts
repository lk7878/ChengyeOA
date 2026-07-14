import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

type BuildPkg = (options: {
  serverRoot: string;
  outputDirectory: string;
  runCommand: (command: string, options: { cwd: string; stdio: 'inherit' }) => void;
}) => { engineFile: string; outputFile: string; runDirectory: string; staticDirectory: string };

function loadBuildPkg(): BuildPkg {
  return (require('../../scripts/lib/pkg-build') as { buildPkg: BuildPkg }).buildPkg;
}

function createFixture(): { outputDirectory: string; serverRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-build-'));
  const serverRoot = path.join(root, 'apps', 'server');
  const outputDirectory = path.join(root, 'apps', 'dist');
  const generatedClient = path.join(serverRoot, 'node_modules', '.prisma', 'client');
  fs.mkdirSync(generatedClient, { recursive: true });
  fs.writeFileSync(path.join(generatedClient, 'query_engine-windows.dll.node'), 'generated engine');
  return { outputDirectory, serverRoot };
}

test('pkg build emits the executable and physical Prisma engine in the installer portable directory', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));
  const commands: string[] = [];

  const result = loadBuildPkg()({
    ...fixture,
    runCommand(command) {
      commands.push(command);
      if (command === 'npm run build') {
        const staticDirectory = path.join(fixture.serverRoot, 'dist', 'public');
        fs.mkdirSync(staticDirectory, { recursive: true });
        fs.writeFileSync(path.join(staticDirectory, 'index.html'), 'packaged static asset');
      }
      if (command.startsWith('pkg .')) {
        const outputFile = path.join(fixture.outputDirectory, 'law-firm-system', 'law-firm-system.exe');
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, 'packaged executable');
      }
    },
  });

  assert.deepEqual(commands.map(command => command.split(' ')[0]), ['npm', 'pkg']);
  assert.equal(
    commands[1],
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
    'packaged static asset',
  );
});

test('pkg build cleans package output when the static build directory is missing', (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(path.dirname(path.dirname(fixture.serverRoot)), { recursive: true, force: true }));

  assert.throws(
    () => loadBuildPkg()({
      ...fixture,
      runCommand(command) {
        if (command.startsWith('pkg .')) {
          const outputFile = path.join(fixture.outputDirectory, 'law-firm-system', 'law-firm-system.exe');
          fs.mkdirSync(path.dirname(outputFile), { recursive: true });
          fs.writeFileSync(outputFile, 'packaged executable');
        }
      },
    }),
    /Packaged static source is missing or not a directory/,
  );

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
      runCommand(command) {
        if (command === 'npm run build') {
          assert.equal(fs.existsSync(staleFile), false);
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
