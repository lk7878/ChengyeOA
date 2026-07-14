'use strict';

const fs = require('fs');
const path = require('path');
const { cleanBuildOutputs } = require('./build-artifacts');
const {
  materializePrismaQueryEngineLibrary,
  resolvePackagedPrismaQueryEngineLibrary,
} = require('./prisma-engine-path');

function requireNonemptyFile(file, description) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size <= 0) {
    throw new Error(`${description} is missing or empty: ${file}`);
  }
}

function buildPkg({ serverRoot, outputDirectory, runCommand }) {
  const portableDirectory = path.join(outputDirectory, 'law-firm-system');
  const outputFile = path.join(portableDirectory, 'law-firm-system.exe');

  cleanBuildOutputs(serverRoot, outputDirectory);
  try {
    runCommand('npm run build', { cwd: serverRoot, stdio: 'inherit' });
    fs.mkdirSync(portableDirectory, { recursive: true });
    runCommand(`pkg . --targets node22-win-x64 --options no-experimental-require-module --output "${outputFile}"`, {
      cwd: serverRoot,
      stdio: 'inherit',
    });
    requireNonemptyFile(outputFile, 'Packaged executable');

    const engineFile = materializePrismaQueryEngineLibrary([
      path.join(serverRoot, 'node_modules', '.prisma', 'client'),
    ], portableDirectory);
    resolvePackagedPrismaQueryEngineLibrary(outputFile);
    return { engineFile, outputFile };
  } catch (error) {
    cleanBuildOutputs(serverRoot, outputDirectory);
    throw error;
  }
}

module.exports = { buildPkg };
