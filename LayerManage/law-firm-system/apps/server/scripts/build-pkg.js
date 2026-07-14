'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { cleanBuildOutputs } = require('./lib/build-artifacts');

const serverRoot = path.join(__dirname, '..');
const outputDir = path.join(serverRoot, '..', 'dist');
const outputFile = path.join(outputDir, 'law-firm-system.exe');

cleanBuildOutputs(serverRoot, outputDir);
execSync('npm run build', { cwd: serverRoot, stdio: 'inherit' });
fs.mkdirSync(outputDir, { recursive: true });
execSync('pkg . --targets node22-win-x64 --output ../dist/law-firm-system.exe', {
  cwd: serverRoot,
  stdio: 'inherit',
});
