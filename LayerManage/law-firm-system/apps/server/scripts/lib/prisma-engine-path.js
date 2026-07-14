'use strict';

const fs = require('fs');
const path = require('path');

const WINDOWS_QUERY_ENGINE_LIBRARY = 'query_engine-windows.dll.node';

function resolvePrismaQueryEngineLibrary(clientDirectories) {
  for (const clientDirectory of clientDirectories) {
    const candidate = path.resolve(clientDirectory, WINDOWS_QUERY_ENGINE_LIBRARY);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

module.exports = { resolvePrismaQueryEngineLibrary };
