import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { MasterDataError } from '../master-data/master-data-errors';

export const APPROVAL_FILE_LIMIT = 10 * 1024 * 1024;
export function fileError(code = 'APPROVAL_FILE_INVALID', status = 400): never {
  throw new MasterDataError(code, status);
}

/** Inspect actual bytes, including bounded OOXML inflation; never trust the supplied MIME. */
export function validateApprovalFile(fileName: string, bytes: Buffer): string {
  if (!fileName || fileName.length > 200 || /[<>:"/\\|?*]/.test(fileName) || [...fileName].some(char => char.charCodeAt(0) < 32)) fileError();
  if (!bytes.length || bytes.length > APPROVAL_FILE_LIMIT) fileError('APPROVAL_FILE_TOO_LARGE');
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ext === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (ext === '.pdf' && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (ext === '.xlsx' || ext === '.docx') {
    validateOfficeZip(bytes, ext);
    return ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  fileError();
}

export function validateOfficeZip(bytes: Buffer, ext: string): void {
  try {
    let end = bytes.length - 22;
    const minimum = Math.max(0, bytes.length - 65557);
    while (end >= minimum && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < minimum || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fileError();
    const count = bytes.readUInt16LE(end + 10);
    if (!count || count > 1000) fileError();
    let offset = bytes.readUInt32LE(end + 16);
    let expanded = 0;
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) fileError();
      const flags = bytes.readUInt16LE(offset + 8);
      const method = bytes.readUInt16LE(offset + 10);
      const compressed = bytes.readUInt32LE(offset + 20);
      const size = bytes.readUInt32LE(offset + 24);
      expanded += size;
      if ((flags & 1) || expanded > 50 * 1024 * 1024 || ![0, 8].includes(method)) fileError();
      const nameLength = bytes.readUInt16LE(offset + 28);
      const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (names.has(name) || /(^\/|\\|(^|\/)\.\.\/|vbaProject|activeX|embeddings)/i.test(name)) fileError();
      names.add(name);
      const local = bytes.readUInt32LE(offset + 42);
      if (bytes.readUInt32LE(local) !== 0x04034b50) fileError();
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > offset || start + compressed > bytes.length) fileError();
      const raw = bytes.subarray(start, start + compressed);
      const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, size) }) : raw;
      if (data.length !== size) fileError();
      if (/\.xml$|\.rels$/i.test(name)) {
        const xml = data.toString('utf8');
        if (/<!DOCTYPE|<!ENTITY|macroEnabled|TargetMode\s*=\s*["']External["']/i.test(xml)) fileError('APPROVAL_FILE_EXTERNAL_CONTENT');
      }
      offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    if (!names.has('[Content_Types].xml') || !names.has(ext === '.xlsx' ? 'xl/workbook.xml' : ext === '.pptx' ? 'ppt/presentation.xml' : 'word/document.xml')) fileError();
  } catch (error) {
    if (error instanceof MasterDataError) throw error;
    fileError();
  }
}
