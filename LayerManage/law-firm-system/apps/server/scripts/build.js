// Post-build script: copy necessary files to dist/ for packaging
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Ensure dist exists
if (!fs.existsSync(dist)) {
  console.error('Error: dist/ does not exist. Run tsc first.');
  process.exit(1);
}

const copies = [
  ['public', 'public'],
  ['package.json', 'package.json'],
  ['.env', '.env'],
  ['prisma/schema.prisma', 'prisma/schema.prisma'],
  // Copy migrations for database initialization
  ['prisma/migrations', 'prisma/migrations'],
];

for (const [src, dest] of copies) {
  const srcPath = path.join(root, src);
  const destPath = path.join(dist, dest);

  if (!fs.existsSync(srcPath)) {
    console.log(`  skip: ${src} (not found)`);
    continue;
  }

  // Ensure parent directory exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.cpSync(srcPath, destPath, { recursive: true });
  console.log(`  copy: ${src} -> dist/${dest}`);
}

// Create a minimal package.json in dist for Egg.js
const distPkg = { name: 'law-firm-server', egg: { typescript: false } };
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(distPkg, null, 2));
console.log('  create: dist/package.json (minimal for Egg.js)');

console.log('Post-build complete.');
