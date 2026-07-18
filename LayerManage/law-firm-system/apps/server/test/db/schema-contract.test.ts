import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const schema = fs.readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');

test('uses PostgreSQL and retains exactly 26 current models', () => {
  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 26);
});

test('adds the SPEC-002 trust-root schema', () => {
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 26);
  assert.match(schema, /model SystemInitialization[\s\S]*id\s+String\s+@id/);
  assert.match(schema, /rootOrganizationId\s+String\s+@unique/);
  assert.match(schema, /superAdminUserId\s+String\s+@unique/);
  assert.match(schema, /code\s+String\s+@unique/);
  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /credentialVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /failedLoginCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /userId\s+String\?[\s\S]*onDelete: SetNull/);
});

test('adds the SPEC-003 expanded organization and personnel schema', () => {
  assert.match(schema, /model Organization[\s\S]*code\s+String\s+@unique/);
  assert.match(schema, /model Organization[\s\S]*path\s+String\s+@unique/);
  assert.match(schema, /model Organization[\s\S]*level\s+Int\s+@default\(0\)/);
  assert.match(schema, /model Organization[\s\S]*version\s+Int\s+@default\(1\)/);
  assert.match(schema, /model Position[\s\S]*organizationId\s+String\s+@map\("orgId"\)/);
  assert.match(schema, /model Position[\s\S]*categoryCode\s+String/);
  assert.match(schema, /model Employee[\s\S]*professionalDirections\s+String\[\]\s+@default\(\[\]\)/);
  assert.match(schema, /model EmployeeAssignment\s+\{/);
  assert.match(schema, /model ProfessionalTeam\s+\{/);
  assert.match(schema, /model ProfessionalTeamMember\s+\{/);
});

test('maps every current money field to numeric 18,2', () => {
  const moneyLines = schema.split('\n').filter(line => /\b(cost|amount|paidAmount|receivedAmount|fee|score|bonus)\b/.test(line));
  assert.ok(moneyLines.length > 0);
  assert.ok(moneyLines.every(line => line.includes('@db.Decimal(18, 2)')));
});

test('keeps legacy JSON-like fields as strings', () => {
  for (const field of ['tags', 'paymentTerms', 'teamIds', 'kpiData']) {
    assert.match(schema, new RegExp(`\\b${field}\\s+String\\??`));
  }
});
