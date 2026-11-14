import { isInventoryDecimal } from './inventory-decimal';
import type { Directory, Field, RecordRow } from './types';

export function parseClipboard(text: string): string[][] {
  if (!text.length || text.length > 1_000_000) throw new Error('粘贴内容为空或过大。');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '\t' || c === '\n') {
      row.push(cell);
      cell = '';
      closed = false;
      if (c === '\n') {
        rows.push(row);
        row = [];
      }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed) throw new Error('引号后的内容格式不正确。');
      cell += c;
    }
  }
  if (quoted) throw new Error('多行文本的引号未闭合。');
  if (cell || row.length || !source.endsWith('\n')) rows.push([...row, cell]);
  if (
    !rows.length ||
    rows.length > 100 ||
    rows.some((r) => r.length !== rows[0].length) ||
    rows.length * rows[0].length > 1000
  )
    throw new Error('请粘贴规则矩形区域，每批最多 100 行、1000 个单元格。');
  return rows;
}

export function clipboardValue(field: Field, raw: string, directory: Directory): unknown {
  if (!field.writable) throw new Error('字段只读');
  if (['FILE', 'RELATION'].includes(field.type)) throw new Error('请使用附件或关联编辑器');
  if (raw === '') return null;
  const value = raw.trim();
  const options =
    field.type === 'USER'
      ? directory.employees
      : field.type === 'ORGANIZATION'
        ? directory.organizations
        : field.options.choices || [];
  const option = (name: string) => {
    const matches = options.filter((o) => o.name === name || o.id === name);
    if (matches.length !== 1) throw new Error('选项或人员名称必须唯一匹配');
    return matches[0].id;
  };
  switch (field.type) {
    case 'NUMBER':
      if (isInventoryDecimal(field)) {
        if (!/^-?\d{1,15}(\.\d{1,3})?$/.test(value)) throw new Error('库存数量最多三位小数');
        return value;
      }
      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
        !Number.isFinite(Number(value)) ||
        Math.abs(Number(value)) > 1e15
      )
        throw new Error('数字格式不正确');
      return Number(value);
    case 'CURRENCY':
      if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(value)) throw new Error('金额最多两位小数');
      return value;
    case 'BOOLEAN':
      if (['true', '1', '是', '已勾选'].includes(value.toLowerCase())) return true;
      if (['false', '0', '否', '未勾选'].includes(value.toLowerCase())) return false;
      throw new Error('勾选值请使用 是/否 或 true/false');
    case 'DATE':
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw new Error('日期请使用 YYYY-MM-DD');
      return value;
    case 'DATETIME':
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value)))
        throw new Error('日期时间必须包含时区');
      return new Date(value).toISOString();
    case 'SINGLE_SELECT':
    case 'USER':
    case 'ORGANIZATION':
      return option(value);
    case 'MULTI_SELECT':
      return [...new Set(value.split(/[,，、]/).map((v) => option(v.trim())))];
    case 'TEXT':
    case 'LONG_TEXT':
    case 'PHONE':
    case 'URL':
      return raw;
    default:
      throw new Error('此字段不支持文本粘贴');
  }
}

export interface PasteSnapshot {
  tableId: string;
  schemaVersion: number;
  rows: RecordRow[];
  fields: Field[];
  directory: Directory;
  allowAppend: boolean;
}
export function preparePaste(source: string, snapshot: PasteSnapshot) {
  const matrix = parseClipboard(source);
  if (matrix[0].length > snapshot.fields.length) throw new Error('粘贴超出右侧可见字段范围。');
  if (matrix.length > snapshot.rows.length && !snapshot.allowAppend)
    throw new Error('粘贴超出本页记录范围，请分批操作。');
  return matrix.map((cells, index) => {
    const row = snapshot.rows[index];
    if (row?.writable === false) throw new Error(`第 ${index + 1} 行没有编辑权限。`);
    const values = Object.fromEntries(
      cells.map((cell, col) => {
        const field = snapshot.fields[col];
        try {
          return [field.id, clipboardValue(field, cell, snapshot.directory)];
        } catch (e) {
          throw new Error(`第 ${index + 1} 行 / ${field.name}：${(e as Error).message}`, { cause: e });
        }
      }),
    );
    return { ...(row ? { id: row.id, version: row.version } : {}), values };
  });
}
