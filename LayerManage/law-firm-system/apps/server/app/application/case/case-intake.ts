import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { assertExactKeys, normalizeRequiredText } from '../../domain/master-data/master-data-validation';
import { ATTACHMENT_CATEGORIES, INTAKE_FIELDS, INTAKE_OPTIONS, CaseIntake } from './intake-contract';

function invalid(): never { throw new MasterDataError('VALIDATION_FAILED', 400); }

export function normalizeIntake(input: unknown): CaseIntake {
  if (input === undefined) return {};
  assertExactKeys(input, INTAKE_FIELDS.map(([key]) => key));
  const result: CaseIntake = {};
  for (const [key, , kind] of INTAKE_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    const text = normalizeRequiredText(value, 1, kind === 'textarea' ? 2000 : 200);
    if (kind === 'money' || kind === 'ratio') {
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(text)) invalid();
      if (kind === 'ratio' && Number(text) > 100) invalid();
      const [whole, fraction = ''] = text.split('.');
      result[key] = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
    } else if (kind === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) invalid();
      const date = new Date(text);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) invalid();
      result[key] = text;
    } else {
      if (kind === 'select' && !INTAKE_OPTIONS[key].includes(text)) invalid();
      if (key === 'customerPhone' && !/^[+\d][\d\s()-]{2,29}$/.test(text)) invalid();
      result[key] = text;
    }
  }
  if (result.agencyProcedure === '自定义' && !result.customProcedure) invalid();
  if (result.agencyProcedure !== '自定义') delete result.customProcedure;
  return result;
}

const MAX_BYTES = 10 * 1024 * 1024;
const storageRoot = () => path.join(process.cwd(), 'var', 'storage', 'case-files');
interface PreparedAttachment { fileName: string; fileType: string; category: string; filePath: string; buffer: Buffer }

export function prepareAttachments(input: unknown): PreparedAttachment[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 20) invalid();
  let total = 0;
  return input.map(file => {
    assertExactKeys(file, ['fileName', 'fileType', 'category', 'base64']);
    const fileName = normalizeRequiredText(file.fileName, 1, 255);
    const fileType = normalizeRequiredText(file.fileType, 1, 100);
    const category = normalizeRequiredText(file.category, 1, 20);
    if (!ATTACHMENT_CATEGORIES.some(value => value === category)) invalid();
    if (!/\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(fileName)) invalid();
    if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) invalid();
    const buffer = Buffer.from(file.base64, 'base64');
    total += buffer.length;
    if (!buffer.length || total > MAX_BYTES || buffer.toString('base64') !== file.base64) invalid();
    return { fileName, fileType, category, buffer, filePath: randomUUID() };
  });
}

export function persistAttachments(files: PreparedAttachment[]): void {
  if (!files.length) return;
  fs.mkdirSync(storageRoot(), { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(storageRoot(), file.filePath), file.buffer, { flag: 'wx' });
}

export function cleanAttachments(files: PreparedAttachment[]): void {
  for (const file of files) {
    try { fs.unlinkSync(path.join(storageRoot(), file.filePath)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** Database deletion has committed; a disk cleanup failure must not report the business write as failed. */
export function removeStoredAttachments(files: { filePath: string }[]): void {
  for (const file of files) {
    if (path.basename(file.filePath) !== file.filePath) continue;
    try { fs.unlinkSync(path.join(storageRoot(), file.filePath)); } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn('Case attachment cleanup failed:', code);
    }
  }
}
