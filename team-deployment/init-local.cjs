// Only for a NEW LOCAL development checkout. Does not start services or change a database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'LayerManage/law-firm-system');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 20) throw new Error('Use Node 22.20+ within the 22.x release line.');
for (const p of ['apps/server/.env.example', 'infra/postgres/compose.yml']) {
  if (!fs.existsSync(path.join(app, p))) throw new Error('Place team-deployment beside LayerManage in the extracted source root.');
}
const files = ['apps/server/.env', 'infra/postgres/.env', 'infra/postgres/compose.team-local.yml'];
for (const p of files) if (fs.existsSync(path.join(app, p))) throw new Error('Refusing to overwrite existing file: ' + p);
const random = () => crypto.randomBytes(32).toString('hex');
const dbPassword = random(), testPassword = random();
const server = `NODE_ENV=development
LOCAL_PASSWORD_LOGIN=false
PORT=7001
DATABASE_URL="postgresql://chengye_app:${dbPassword}@localhost:55432/chengye_oa?schema=public"
DATABASE_URL_TEST="postgresql://chengye_test:${testPassword}@localhost:55432/chengye_oa_test?schema=public"
JWT_SECRET="${random()}"
APP_KEYS="${random()},${random()}"
MFA_ENCRYPTION_KEY_V1="${crypto.randomBytes(32).toString('base64')}"
CORS_ALLOWED_ORIGINS="http://localhost:3000"
ALLOW_SUPER_ADMIN_RECOVERY=false
EVENT_WORKER_ENABLED=true
LEAD_RECYCLE_ENABLED=true
LEAD_RECYCLE_NO_FOLLOW_HOURS=24
APPROVAL_TIMEOUT_HOURS=72
`;
const postgres = `POSTGRES_DB=chengye_oa
POSTGRES_USER=chengye_app
POSTGRES_PASSWORD=${dbPassword}
POSTGRES_TEST_DB=chengye_oa_test
POSTGRES_TEST_USER=chengye_test
POSTGRES_TEST_PASSWORD=${testPassword}
`;
const compose = `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: \${POSTGRES_DB:?required}
      POSTGRES_USER: \${POSTGRES_USER:?required}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?required}
      POSTGRES_TEST_DB: \${POSTGRES_TEST_DB:?required}
      POSTGRES_TEST_USER: \${POSTGRES_TEST_USER:?required}
      POSTGRES_TEST_PASSWORD: \${POSTGRES_TEST_PASSWORD:?required}
      TZ: Asia/Shanghai
    ports:
      - "127.0.0.1:55432:5432"
    volumes:
      - team_postgres_data:/var/lib/postgresql/data
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped
volumes:
  team_postgres_data:
`;
// Dollar escapes are written literally into YAML, not evaluated by JavaScript.
for (const [i, value] of [server, postgres, compose].entries()) {
  fs.writeFileSync(path.join(app, files[i]), value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
console.log('Created NEW LOCAL configuration with random secrets. Values were not printed.');
console.log('Database port is bound to loopback only. Follow the installation guide next.');
