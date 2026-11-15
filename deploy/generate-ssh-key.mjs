import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const target = process.argv[2];
if (!target) throw new Error('missing output path');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
writeFileSync(target, privateKey.export({ type: 'pkcs1', format: 'pem' }), { mode: 0o600 });
