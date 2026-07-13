import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SQLiteFixtures {
  primaryPath: string;
  secondaryPath: string;
  cleanup(): void;
}

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
    'CREATE TABLE "User" (id TEXT PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL, phone TEXT)',
  ];

  createDatabase(primaryPath, [
    ...schema,
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-shared', 'Shared organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-mismatch', 'Primary organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"User\" (id, username, password, phone) VALUES ('user-primary', 'duplicate-username', 'primary-secret', '13800138000')",
  ]);
  createDatabase(secondaryPath, [
    ...schema,
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-shared', 'Shared organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-mismatch', 'Secondary organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"Organization\" (id, name, phone, updatedAt) VALUES ('org-secondary-only', 'Secondary only organization', '13800138000', '2026-07-12T00:00:00.000Z')",
    "INSERT INTO \"User\" (id, username, password, phone) VALUES ('user-secondary', 'duplicate-username', 'secondary-secret', '13800138000')",
  ]);

  return {
    primaryPath,
    secondaryPath,
    cleanup() {
      fs.rmSync(directory, { force: true, recursive: true });
    },
  };
}
