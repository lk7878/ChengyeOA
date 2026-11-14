import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const schema = fs.readFileSync(path.resolve('prisma/schema.prisma'), 'utf8');

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `${name} model is missing`);
  return match[0];
}

test('uses PostgreSQL and retains exactly 68 current models', () => {
  assert.match(schema, /provider\s*=\s*"postgresql"/);
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 68);
});

test('adds the SPEC-002 trust-root schema', () => {
  assert.equal([...schema.matchAll(/^model\s+\w+\s+\{/gm)].length, 68);
  assert.match(schema, /model SystemInitialization[\s\S]*id\s+String\s+@id/);
  assert.match(schema, /rootOrganizationId\s+String\s+@unique/);
  assert.match(schema, /superAdminUserId\s+String\s+@unique/);
  assert.match(schema, /code\s+String\s+@unique/);
  assert.match(schema, /mustChangePassword\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /credentialVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /failedLoginCount\s+Int\s+@default\(0\)/);
  assert.match(schema, /userId\s+String\?[\s\S]*onDelete: SetNull/);
});

test('adds SPEC-007 event evidence models and notification compatibility fields', () => {
  const eventLog = modelBlock('EventLog');
  const subscription = modelBlock('EventSubscription');
  const delivery = modelBlock('EventDelivery');
  const handlerLog = modelBlock('EventHandlerLog');
  const notification = modelBlock('Notification');

  assert.match(eventLog, /^\s*payload\s+Json/m);
  assert.match(eventLog, /@@index\(\[dispatchedAt, createdAt\]\)/);
  assert.match(eventLog, /@@index\(\[eventType, eventVersion, createdAt\]\)/);
  assert.match(eventLog, /@@index\(\[objectType, objectId, occurredAt\]\)/);
  assert.match(eventLog, /@@index\(\[traceId\]\)/);
  assert.match(subscription, /^\s*filterJson\s+Json\?/m);
  assert.match(delivery, /@@unique\(\[eventId, handlerCode\], map: "event_delivery_event_handler_key"\)/);
  assert.match(delivery, /event\s+EventLog[\s\S]*onDelete: Restrict/);
  assert.match(delivery, /subscription\s+EventSubscription[\s\S]*onDelete: Restrict/);
  assert.match(handlerLog, /@@unique\(\[deliveryId, attemptNumber\], map: "event_handler_log_delivery_attempt_key"\)/);
  assert.match(handlerLog, /delivery\s+EventDelivery[\s\S]*onDelete: Restrict/);
  assert.match(notification, /^\s*deduplicationKey\s+String\?\s+@unique/m);
  assert.match(notification, /^\s*routeUrl\s+String\?/m);
});

test('adds the SPEC-008 singleton worker runtime status model without sensitive fields', () => {
  const runtimeStatus = modelBlock('EventWorkerRuntimeStatus');

  assert.match(runtimeStatus, /^\s*slot\s+String\s+@id/m);
  assert.match(runtimeStatus, /^\s*configuredEnabled\s+Boolean/m);
  assert.match(runtimeStatus, /^\s*state\s+String/m);
  assert.match(runtimeStatus, /^\s*processStartedAt\s+DateTime\s+@db\.Timestamptz\(3\)/m);
  assert.match(runtimeStatus, /^\s*lastHeartbeatAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/m);
  assert.match(runtimeStatus, /^\s*lastSuccessfulTickAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/m);
  assert.match(runtimeStatus, /^\s*lastStoppedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/m);
  assert.match(runtimeStatus, /^\s*version\s+Int\s+@default\(1\)/m);
  assert.match(runtimeStatus, /^\s*updatedAt\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(3\)/m);
  assert.match(runtimeStatus, /@@map\("event_worker_runtime_status"\)/);
  assert.doesNotMatch(runtimeStatus, /workerId|lockedBy|host(?:name)?|pid|payload|error|message|stack/i);
});

test('adds the SPEC-006 identity-security aggregates and restrictive relations', () => {
  for (const name of ['MfaFactor', 'MfaRecoveryCode', 'AuthChallenge', 'AuthSession', 'StepUpGrant']) {
    assert.match(schema, new RegExp(`model ${name} \\{`));
  }

  const factor = modelBlock('MfaFactor');
  const session = modelBlock('AuthSession');
  const grant = modelBlock('StepUpGrant');
  assert.match(factor, /encryptedSecret\s+String/);
  assert.match(factor, /lastAcceptedCounter\s+BigInt\?/);
  assert.match(factor, /user\s+User[\s\S]*onDelete: Restrict/);
  assert.match(session, /refreshTokenHash\s+String\s+@unique/);
  assert.match(session, /previousRefreshTokenHash\s+String\?\s+@unique/);
  assert.match(session, /user\s+User[\s\S]*onDelete: Restrict/);
  assert.match(grant, /session\s+AuthSession[\s\S]*onDelete: Restrict/);
  assert.match(grant, /user\s+User[\s\S]*onDelete: Restrict/);
});

test('adds immutable SPEC-005 governance aggregates and restrictive relations', () => {
  const operation = modelBlock('AdminOperation');
  const review = modelBlock('AdminOperationReview');
  const execution = modelBlock('AdminOperationExecution');
  const user = modelBlock('User');

  assert.match(operation, /^\s*payloadSnapshot\s+Json/m);
  assert.match(operation, /^\s*payloadHash\s+String/m);
  assert.match(operation, /^\s*version\s+Int\s+@default\(1\)/m);
  assert.match(operation, /@@unique\(\[requesterUserId, idempotencyKey\]\)/);
  assert.match(operation, /requester\s+User[\s\S]*onDelete: Restrict/);
  assert.match(operation, /relatedOperation\s+AdminOperation\?[\s\S]*onDelete: Restrict/);

  assert.match(review, /operation\s+AdminOperation[\s\S]*onDelete: Restrict/);
  assert.match(review, /reviewer\s+User[\s\S]*onDelete: Restrict/);
  assert.match(execution, /^\s*beforeSnapshot\s+Json\?/m);
  assert.match(execution, /^\s*afterSnapshot\s+Json\?/m);
  assert.match(execution, /@@unique\(\[operationId, attemptNo\]\)/);
  assert.match(execution, /operation\s+AdminOperation[\s\S]*onDelete: Restrict/);

  assert.match(user, /adminOperationsRequested\s+AdminOperation\[\]\s+@relation\("AdminOperationRequester"\)/);
  assert.match(user, /adminOperationReviews\s+AdminOperationReview\[\]\s+@relation\("AdminOperationReviewer"\)/);
});

test('adds the six SPEC-004 authorization models and grant history', () => {
  for (const model of [
    'DataScope',
    'DataScopeTarget',
    'RoleDataScope',
    'FieldPermission',
    'UserPermissionGrant',
    'EmployeeReportingLine',
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
  }

  const userRole = modelBlock('UserRole');
  assert.match(userRole, /^\s*source\s+String\s+@default\("PERMANENT"\)/m);
  assert.match(userRole, /^\s*validFrom\s+DateTime\s+@default\(now\(\)\)/m);
  assert.match(userRole, /^\s*validUntil\s+DateTime\?/m);
  assert.match(userRole, /^\s*revokedAt\s+DateTime\?/m);
  assert.match(userRole, /^\s*version\s+Int\s+@default\(1\)/m);
  assert.doesNotMatch(userRole, /@@unique\(\[userId, roleId\]\)/);

  const permission = modelBlock('Permission');
  assert.match(permission, /^\s*resource\s+String/m);
  assert.match(permission, /^\s*action\s+String/m);
  assert.match(permission, /^\s*riskLevel\s+String/m);
  assert.match(permission, /^\s*version\s+Int\s+@default\(1\)/m);

  const rolePermission = modelBlock('RolePermission');
  assert.match(rolePermission, /role\s+Role[\s\S]*onDelete: Restrict/);
  assert.match(rolePermission, /permission\s+Permission[\s\S]*onDelete: Restrict/);
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

test('uses employee assignments as the only organization ownership source', () => {
  const employee = modelBlock('Employee');
  const organization = modelBlock('Organization');
  const position = modelBlock('Position');

  assert.doesNotMatch(employee, /^\s*orgId\s+/m);
  assert.doesNotMatch(employee, /^\s*positionId\s+/m);
  assert.doesNotMatch(employee, /^\s*organization\s+Organization\b/m);
  assert.doesNotMatch(employee, /^\s*position\s+Position\b/m);
  assert.doesNotMatch(organization, /^\s*employees\s+Employee\[\]/m);
  assert.doesNotMatch(position, /^\s*employees\s+Employee\[\]/m);
  assert.match(employee, /^\s*assignments\s+EmployeeAssignment\[\]/m);
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
