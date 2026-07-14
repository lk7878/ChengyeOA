'use strict';

const path = require('path');
const { cleanBuildOutputs } = require('./lib/build-artifacts');

cleanBuildOutputs(path.join(__dirname, '..'));
