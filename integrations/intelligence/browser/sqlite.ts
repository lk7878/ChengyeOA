import sqliteInit from '@sqlite.org/sqlite-wasm';

let sqlite: any;
let pool: any;
const connections = new Set<DatabaseSync>();

/** Called only while the owning browser tab holds the per-user Web Lock. */
export async function openLocalDatabase(partition: string, namespace = 'wiki') {
  if (!/^[a-f0-9]{64}$/.test(partition)) throw new Error('Invalid local database partition');
  if (pool) throw new Error('Local database already initialized');
  sqlite = await sqliteInit({ locateFile: (file: string) => new URL(`./sqlite/${file}`, import.meta.url).href });
  pool = await sqlite.installOpfsSAHPoolVfs({
    name: `chengye-${namespace}-${partition}`, directory: `/chengye-${namespace}-${partition}`, initialCapacity: 12,
  });
}

/** Close handles without deleting the persistent VFS or any user files. */
export function closeLocalDatabase() {
  for (const connection of [...connections]) connection.close();
  pool?.pauseVfs(); pool = undefined;
}

/** Native node:sqlite subset used by the unmodified Harness Store. */
export class DatabaseSync {
  private db: any;
  constructor(path: string) {
    if (!pool) throw new Error('Local SQLite is not initialized');
    if (!['/knowledge.db', '/journal.db', '/workspace.db'].includes(path)) throw new Error('Unexpected local database path');
    this.db = new pool.OpfsSAHPoolDb(path);
    connections.add(this);
  }
  exec(sql: string) {
    // SAH Pool uses a single locked connection. Rollback journals preserve the
    // native synchronous transaction contract without WAL shared-memory files.
    this.db.exec(sql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL/gi, 'PRAGMA journal_mode=DELETE'));
  }
  prepare(sql: string) {
    const query = (args: unknown[], mode: 'get' | 'all' | 'run') => {
      const statement = this.db.prepare(sql);
      try {
        if (args.length) statement.bind(args);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          if (mode !== 'run') rows.push(statement.get({}));
          if (mode === 'get') break;
        }
        if (mode === 'get') return rows[0];
        if (mode === 'all') return rows;
        return { changes: this.db.changes(), lastInsertRowid: this.db.selectValue('SELECT last_insert_rowid()') };
      } finally { statement.finalize(); }
    };
    return { get: (...args: unknown[]) => query(args, 'get'), all: (...args: unknown[]) => query(args, 'all'), run: (...args: unknown[]) => query(args, 'run') };
  }
  close() { if (this.db) { this.db.close(); this.db = undefined; connections.delete(this); } }
}
