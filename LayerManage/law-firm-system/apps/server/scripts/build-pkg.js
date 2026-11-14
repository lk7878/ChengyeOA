'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { buildPkg } = require('./lib/pkg-build');

const serverRoot = path.join(__dirname, '..');

buildPkg({
  serverRoot,
  outputDirectory: path.join(serverRoot, '..', 'dist'),
  runCommand: execSync,
});
