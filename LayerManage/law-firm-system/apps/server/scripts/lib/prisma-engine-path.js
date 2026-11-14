'use strict';

const fs = require('fs');
const path = require('path');

const WINDOWS_QUERY_ENGINE_LIBRARY = 'query_engine-windows.dll.node';
const PACKAGED_ENGINE_DIRECTORY = 'prisma-engine';

function isNonemptyFile(candidate) {
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0;
}

function resolvePrismaQueryEngineLibrary(clientDirectories) {
  for (const clientDirectory of clientDirectories) {
    const candidate = path.resolve(clientDirectory, WINDOWS_QUERY_ENGINE_LIBRARY);
    if (isNonemptyFile(candidate)) return candidate;
  }
  return undefined;
}

function packagedPrismaQueryEnginePath(executableDirectory) {
  return path.resolve(executableDirectory, PACKAGED_ENGINE_DIRECTORY, WINDOWS_QUERY_ENGINE_LIBRARY);
}

function materializePrismaQueryEngineLibrary(clientDirectories, executableDirectory) {
  const source = resolvePrismaQueryEngineLibrary(clientDirectories);
  if (!source) throw new Error('Generated Prisma query engine is missing or empty. Run prisma generate before packaging.');

  const destination = packagedPrismaQueryEnginePath(executableDirectory);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (!isNonemptyFile(destination)) throw new Error(`Copied Prisma query engine is missing or empty: ${destination}`);
  return destination;
}

function resolvePackagedPrismaQueryEngineLibrary(executablePath) {
  const candidate = packagedPrismaQueryEnginePath(path.dirname(executablePath));
  if (!isNonemptyFile(candidate)) throw new Error(`Packaged Prisma query engine is missing or empty: ${candidate}`);
  return candidate;
}

module.exports = {
  materializePrismaQueryEngineLibrary,
  resolvePackagedPrismaQueryEngineLibrary,
  resolvePrismaQueryEngineLibrary,
};
