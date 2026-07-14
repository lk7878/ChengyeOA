import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SQLiteFixtures {
  primaryPath: string;
  secondaryPath: string;
  cleanup(): void;
}

export const FIXTURE_LITERALS = {
  approvalContent: '{"purpose":"preserve approval business data"}',
  approvalId: 'approval-sensitive',
  approvalRemark: 'private approval remark',
  approvalTitle: 'Sensitive approval',
  customerEmail: 'migration-fixture@example.test',
  customerId: 'customer-sensitive',
  customerIdCard: '110101199001011234',
  customerName: 'Sensitive customer',
  customerPhone: '13800138000',
  customerRemark: 'private customer free-text remark',
  duplicateUsername: 'duplicate-username',
  followId: 'follow-sensitive',
  leadFollowContent: 'literal lead follow free-text content',
  nextPlan: 'private next plan',
  organizationMismatchId: 'org-mismatch',
  organizationPrimaryName: 'Primary organization',
  organizationSecondaryName: 'Secondary organization',
  organizationSecondaryOnlyId: 'org-secondary-only',
  organizationSecondaryOnlyName: 'Secondary only organization',
  organizationSharedId: 'org-shared',
  organizationSharedName: 'Shared organization',
  primaryPassword: '$2b$10$primaryPasswordHashLiteral',
  primaryUserId: 'user-primary',
  secondaryPassword: '$2b$10$secondaryPasswordHashLiteral',
  secondaryUserId: 'user-secondary',
} as const;

function createDatabase(databasePath: string, statements: string[]): void {
  const database = new Database(databasePath);

  try {
    for (const statement of statements) {
      database.exec(statement);
    }
  } finally {
    database.close();
  }
}

export function createSQLiteFixtures(): SQLiteFixtures {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-oa-migration-'));
  const primaryPath = path.join(directory, 'primary.db');
  const secondaryPath = path.join(directory, 'secondary.db');
  const schema = [
    'CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, updatedAt TEXT)',
    'CREATE TABLE "User" (id TEXT PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL)',
    'CREATE TABLE "LeadFollow" (id TEXT PRIMARY KEY, content TEXT NOT NULL, nextPlan TEXT)',
    'CREATE TABLE "Customer" (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, idCard TEXT, email TEXT, remark TEXT)',
    'CREATE TABLE "Approval" (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, remark TEXT)',
  ];
  const sharedSensitiveRows = [
    `INSERT INTO "LeadFollow" (id, content, nextPlan) VALUES ('follow-sensitive', '${FIXTURE_LITERALS.leadFollowContent}', 'private next plan')`,
    `INSERT INTO "Customer" (id, name, phone, idCard, email, remark) VALUES ('customer-sensitive', 'Sensitive customer', '${FIXTURE_LITERALS.customerPhone}', '${FIXTURE_LITERALS.customerIdCard}', '${FIXTURE_LITERALS.customerEmail}', '${FIXTURE_LITERALS.customerRemark}')`,
    `INSERT INTO "Approval" (id, title, content, remark) VALUES ('approval-sensitive', 'Sensitive approval', '${FIXTURE_LITERALS.approvalContent}', 'private approval remark')`,
  ];

  createDatabase(primaryPath, [
    ...schema,
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-shared', 'Shared organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-mismatch', 'Primary organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    `INSERT INTO "User" (id, username, password) VALUES ('user-primary', 'duplicate-username', '${FIXTURE_LITERALS.primaryPassword}')`,
    ...sharedSensitiveRows,
  ]);
  createDatabase(secondaryPath, [
    ...schema,
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-shared', 'Shared organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-mismatch', 'Secondary organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-secondary-only', 'Secondary only organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    `INSERT INTO "User" (id, username, password) VALUES ('user-secondary', 'duplicate-username', '${FIXTURE_LITERALS.secondaryPassword}')`,
    ...sharedSensitiveRows,
  ]);

  return {
    primaryPath,
    secondaryPath,
    cleanup() {
      fs.rmSync(directory, { force: true, recursive: true });
    },
  };
}
