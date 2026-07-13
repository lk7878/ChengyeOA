import { randomUUID } from 'node:crypto';
import { BUSINESS_KEYS, TABLE_ORDER, type TableName } from './table-plan';
import type { ConflictKind, DiffReport, RecordConflict, SnapshotRecord, SourceSnapshot } from './types';

const CONFLICT_KINDS: ConflictKind[] = [
  'PRIMARY_ONLY',
  'SECONDARY_ONLY',
  'CONTENT_MISMATCH',
  'BUSINESS_KEY_COLLISION',
];

function recordId(record: SnapshotRecord): string {
  return String(record.id ?? '');
}

function changedFields(primary: SnapshotRecord, secondary: SnapshotRecord): string[] {
  return [...new Set([...Object.keys(primary), ...Object.keys(secondary)])]
    .filter(field => JSON.stringify(primary[field]) !== JSON.stringify(secondary[field]))
    .sort((left, right) => left.localeCompare(right));
}

function businessKey(record: SnapshotRecord, fields: string[]): string | undefined {
  if (fields.some(field => record[field] === undefined || record[field] === null)) {
    return undefined;
  }

  return JSON.stringify(fields.map(field => record[field]));
}

function compareConflicts(left: RecordConflict, right: RecordConflict): number {
  return TABLE_ORDER.indexOf(left.table) - TABLE_ORDER.indexOf(right.table)
    || CONFLICT_KINDS.indexOf(left.kind) - CONFLICT_KINDS.indexOf(right.kind)
    || (left.primaryId ?? '').localeCompare(right.primaryId ?? '')
    || (left.secondaryId ?? '').localeCompare(right.secondaryId ?? '')
    || left.changedFields.join('\u0000').localeCompare(right.changedFields.join('\u0000'));
}

function compareTable(primary: SourceSnapshot, secondary: SourceSnapshot, table: TableName): RecordConflict[] {
  const primaryRecords = primary.tables[table].records;
  const secondaryRecords = secondary.tables[table].records;
  const primaryById = new Map(primaryRecords.map(record => [recordId(record), record]));
  const secondaryById = new Map(secondaryRecords.map(record => [recordId(record), record]));
  const conflicts: RecordConflict[] = [];
  const fields = BUSINESS_KEYS[table] ?? [];
  const primaryCollisionIds = new Set<string>();
  const secondaryCollisionIds = new Set<string>();

  if (fields.length > 0) {
    const secondaryByBusinessKey = new Map<string, SnapshotRecord[]>();
    for (const record of secondaryRecords) {
      const key = businessKey(record, fields);
      if (key !== undefined) {
        secondaryByBusinessKey.set(key, [...(secondaryByBusinessKey.get(key) ?? []), record]);
      }
    }

    for (const primaryRecord of primaryRecords) {
      const key = businessKey(primaryRecord, fields);
      if (key === undefined) {
        continue;
      }

      for (const secondaryRecord of secondaryByBusinessKey.get(key) ?? []) {
        const primaryId = recordId(primaryRecord);
        const secondaryId = recordId(secondaryRecord);
        if (primaryId !== secondaryId) {
          primaryCollisionIds.add(primaryId);
          secondaryCollisionIds.add(secondaryId);
          conflicts.push({
            changedFields: [...fields].sort((left, right) => left.localeCompare(right)),
            kind: 'BUSINESS_KEY_COLLISION',
            primaryId,
            secondaryId,
            table,
          });
        }
      }
    }
  }

  for (const [id, primaryRecord] of primaryById) {
    const secondaryRecord = secondaryById.get(id);
    if (secondaryRecord === undefined) {
      if (!primaryCollisionIds.has(id)) {
        conflicts.push({ changedFields: [], kind: 'PRIMARY_ONLY', primaryId: id, table });
      }
    } else {
      const fields = changedFields(primaryRecord, secondaryRecord);
      if (fields.length > 0) {
        conflicts.push({ changedFields: fields, kind: 'CONTENT_MISMATCH', primaryId: id, secondaryId: id, table });
      }
    }
  }

  for (const id of secondaryById.keys()) {
    if (!primaryById.has(id) && !secondaryCollisionIds.has(id)) {
      conflicts.push({ changedFields: [], kind: 'SECONDARY_ONLY', secondaryId: id, table });
    }
  }

  return conflicts;
}

export function diffSnapshots(primary: SourceSnapshot, secondary: SourceSnapshot): DiffReport {
  const conflicts = TABLE_ORDER
    .flatMap(table => compareTable(primary, secondary, table))
    .sort(compareConflicts);
  const counts = CONFLICT_KINDS.reduce<Record<ConflictKind, number>>((result, kind) => {
    result[kind] = conflicts.filter(conflict => conflict.kind === kind).length;
    return result;
  }, {} as Record<ConflictKind, number>);
  const tableCounts = TABLE_ORDER.reduce<DiffReport['tableCounts']>((result, table) => {
    result[table] = {
      primary: primary.tables[table].rowCount,
      secondary: secondary.tables[table].rowCount,
    };
    return result;
  }, {} as DiffReport['tableCounts']);

  return {
    conflicts,
    counts,
    generatedAt: new Date().toISOString(),
    runId: randomUUID(),
    sources: { primary: primary.source, secondary: secondary.source },
    tableCounts,
  };
}
