'use strict';

const path = require('path');
const { copyBuildAssets } = require('./lib/build-artifacts');

const root = path.join(__dirname, '..');

copyBuildAssets(root);
console.log('Post-build complete.');
