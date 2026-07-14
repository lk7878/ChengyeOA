'use strict';

const fs = require('fs');
const path = require('path');

const assetCopies = [
  ['public', 'public'],
  ['prisma/schema.prisma', 'prisma/schema.prisma'],
  ['prisma/migrations', 'prisma/migrations'],
];

function isForbiddenArtifact(fileName) {
  const lower = fileName.toLowerCase();
  return lower === '.env'
    || lower.startsWith('.env.')
    || /(?:^|[-_.])(?:credentials?|secrets?)(?:[-_.]|$)/i.test(lower)
    || /\.(?:key|pem|p12|pfx)$/i.test(lower);
}

function findForbiddenArtifacts(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return findForbiddenArtifacts(candidate);
    return entry.isFile() && isForbiddenArtifact(entry.name) ? [candidate] : [];
  });
}

function removeIfExists(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function cleanBuildOutputs(serverRoot, packageOutputDir) {
  removeIfExists(path.join(serverRoot, 'dist'));
  if (packageOutputDir) removeIfExists(packageOutputDir);
}

function copyBuildAssets(serverRoot) {
  const dist = path.join(serverRoot, 'dist');
  if (!fs.existsSync(dist)) {
    throw new Error('dist/ does not exist. Run TypeScript compilation first.');
  }

  for (const [source, destination] of assetCopies) {
    const sourcePath = path.join(serverRoot, source);
    if (!fs.existsSync(sourcePath)) continue;
    const destinationPath = path.join(dist, destination);
    removeIfExists(destinationPath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
  }

  const distPackage = { name: 'law-firm-server', egg: { typescript: false } };
  fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(distPackage, null, 2));

  const forbidden = findForbiddenArtifacts(dist);
  if (forbidden.length > 0) {
    throw new Error(`Forbidden build artifacts: ${forbidden.map(file => path.relative(dist, file)).join(', ')}`);
  }
}

module.exports = {
  cleanBuildOutputs,
  copyBuildAssets,
  findForbiddenArtifacts,
  isForbiddenArtifact,
};
