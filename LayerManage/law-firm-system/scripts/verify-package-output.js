'use strict';

const fs = require('fs');
const path = require('path');

function requirePhysicalDirectory(directory, description) {
  if (!fs.existsSync(directory)) throw new Error(`${description} is missing: ${directory}`);
  const status = fs.lstatSync(directory);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`${description} must be a physical directory: ${directory}`);
  }
}

function requireNonemptyPhysicalFile(file, description) {
  if (!fs.existsSync(file)) throw new Error(`${description} is missing: ${file}`);
  const status = fs.lstatSync(file);
  if (status.isSymbolicLink() || !status.isFile() || status.size <= 0) {
    throw new Error(`${description} must be a nonempty physical file: ${file}`);
  }
}

function verifyPackageOutput(packageDirectory) {
  const resolvedPackageDirectory = path.resolve(packageDirectory);
  const executable = path.join(resolvedPackageDirectory, 'law-firm-system.exe');
  const engineFile = path.join(resolvedPackageDirectory, 'prisma-engine', 'query_engine-windows.dll.node');
  const publicDirectory = path.join(resolvedPackageDirectory, 'public');
  const runDirectory = path.join(resolvedPackageDirectory, 'run');

  requirePhysicalDirectory(resolvedPackageDirectory, 'Package directory');
  requireNonemptyPhysicalFile(executable, 'Package executable');
  requirePhysicalDirectory(path.dirname(engineFile), 'Prisma engine directory');
  requireNonemptyPhysicalFile(engineFile, 'Prisma engine');
  requirePhysicalDirectory(publicDirectory, 'Public directory');
  requireNonemptyPhysicalFile(path.join(publicDirectory, 'index.html'), 'Public entry point');
  requirePhysicalDirectory(runDirectory, 'Run directory');
  requireNonemptyPhysicalFile(path.join(runDirectory, '.keep'), 'Run directory marker');

  return { engineFile, executable, packageDirectory: resolvedPackageDirectory, publicDirectory, runDirectory };
}

if (require.main === module) {
  try {
    const packageDirectory = process.argv[2];
    if (!packageDirectory) throw new Error('Package directory argument is required');
    verifyPackageOutput(packageDirectory);
    process.stdout.write(`Verified pkg output: ${path.resolve(packageDirectory)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Package verification failed'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verifyPackageOutput };
