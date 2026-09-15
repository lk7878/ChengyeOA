import { describe, expect, it } from 'vitest';
import { clipboardValue, parseClipboard, preparePaste, type PasteSnapshot } from './clipboard';
import { groupedRows } from './grouping';
import type { Directory, Field, RecordRow } from './types';

const directory: Directory = { employees: [], organizations: [], users: [], teams: [] };
const field = (id: string, type = 'TEXT'): Field => ({
  id,
  name: id,
  type,
  writable: true,
  required: false,
  archived: false,
  position: 0,
  defaultValue: null,
  options: {},
});
const row = (id: string, values: Record<string, unknown>): RecordRow => ({
  id,
  tableId: 't',
  values,
  version: 3,
  createdBy: 'u',
  ownerId: 'u',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('clipboard targeting and conversion', () => {
  it('reads quoted tabs, multiline text, escaped quotes, CRLF and empty cells', () => {
    expect(parseClipboard('\uFEFF"a\tb"\t"line1\r\nline2"\r\n"a""b"\t\r\n')).toEqual([
      ['a\tb', 'line1\nline2'],
      ['a"b', ''],
    ]);
    expect(() => parseClipboard('a\tb\nc')).toThrow('矩形');
    expect(() => parseClipboard('"unclosed')).toThrow('未闭合');
    expect(() => parseClipboard('a\n'.repeat(101))).toThrow('100 行');
  });
  it('does not guess numbers, dates, identities or relation IDs', () => {
    expect(clipboardValue(field('text'), '=SUM(A1:A2)', directory)).toBe('=SUM(A1:A2)');
    expect(clipboardValue(field('number', 'NUMBER'), '1.5e2', directory)).toBe(150);
    expect(() => clipboardValue(field('number', 'NUMBER'), '0x10', directory)).toThrow();
    expect(() => clipboardValue(field('date', 'DATE'), '2026-02-30', directory)).toThrow();
    expect(() => clipboardValue(field('time', 'DATETIME'), '2026-01-01 10:00', directory)).toThrow();
    expect(() => clipboardValue(field('file', 'FILE'), '', directory)).toThrow();
    expect(() =>
      clipboardValue(field('user', 'USER'), '同名', {
        ...directory,
        employees: [
          { id: 'a', name: '同名' },
          { id: 'b', name: '同名' },
        ],
      }),
    ).toThrow('唯一');
    expect(clipboardValue(field('bool', 'BOOLEAN'), '否', directory)).toBe(false);
  });
  it('freezes IDs and versions and rejects row, column and readonly boundaries', () => {
    const snapshot: PasteSnapshot = {
      tableId: 't',
      schemaVersion: 4,
      rows: [row('a', {})],
      fields: [field('title'), field('n', 'NUMBER')],
      directory,
      allowAppend: false,
    };
    expect(preparePaste('text\t2', snapshot)).toEqual([
      { id: 'a', version: 3, values: { title: 'text', n: 2 } },
    ]);
    expect(() => preparePaste('a\nb', snapshot)).toThrow('本页');
    expect(() => preparePaste('a\tb\tc', snapshot)).toThrow('字段范围');
    expect(() => preparePaste('a', { ...snapshot, rows: [{ ...row('a', {}), writable: false }] })).toThrow(
      '第 1 行',
    );
    expect(() =>
      preparePaste('a', { ...snapshot, fields: [{ ...field('title'), writable: false }] }),
    ).toThrow('只读');
    expect(preparePaste('a\nb', { ...snapshot, allowAppend: true })[1]).toEqual({ values: { title: 'b' } });
  });
});

describe('grouped page rows', () => {
  it('normalizes SQL numeric keys, folds without inventing unloaded rows, preserves count', () => {
    const records = [row('a', { n: '1.00' }), row('b', { n: '2' }), row('c', { n: '1.0' })];
    const fields = [field('n', 'CURRENCY')];
    const totals = [
      { keys: [1], count: 20 },
      { keys: [2], count: 1 },
    ];
    const expanded = groupedRows(records, fields, totals, new Set());
    expect(expanded.map((r) => r.id)).toEqual(['group:[1]', 'a', 'c', 'group:[2]', 'b']);
    expect(expanded[0].group).toMatchObject({ loaded: 2, count: 20 });
    expect(groupedRows(records, fields, totals, new Set(['[1]'])).map((r) => r.id)).toEqual([
      'group:[1]',
      'group:[2]',
      'b',
    ]);
    expect(groupedRows(records, fields, [], new Set())[0].group?.count).toBeUndefined();
  });
  it('matches PostgreSQL boolean and JSON-array groups', () => {
    const rows = [row('a', { b: false, s: ['a', 'b'] })];
    expect(
      groupedRows(
        rows,
        [field('b', 'BOOLEAN'), field('s', 'MULTI_SELECT')],
        [{ keys: ['false', '["a", "b"]'], count: 4 }],
        new Set(),
      )[0].group?.count,
    ).toBe(4);
  });
});
