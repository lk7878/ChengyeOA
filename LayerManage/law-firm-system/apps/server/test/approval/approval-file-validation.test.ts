import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { validateApprovalFile, validateOfficeZip } from '../../app/domain/approval/approval-file-validation';

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const bytes = Buffer.from(value); const compressed = deflateRawSync(bytes);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed); centrals.push(central, nameBytes); offset += local.length + nameBytes.length + compressed.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(Buffer.concat(centrals).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
const base = { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<document/>' };
test('meeting PPTX attachments require presentation content and reject macros or external relationships',()=>{
  const ppt={'[Content_Types].xml':'<Types/>','ppt/presentation.xml':'<presentation/>'};
  assert.doesNotThrow(()=>validateOfficeZip(zip(ppt),'.pptx'));
  assert.throws(()=>validateOfficeZip(zip(base),'.pptx'));
  for(const extra of [{'ppt/vbaProject.bin':'macro'},{'ppt/_rels/presentation.xml.rels':'<Relationship TargetMode="External" Target="https://example.com/"/>'}])
    assert.throws(()=>validateOfficeZip(zip({...ppt,...extra}),'.pptx'));
});
test('accepts bounded OOXML and rejects a renamed package of the wrong kind', () => {
  const bytes = zip(base);
  assert.match(validateApprovalFile('申请.docx', bytes), /wordprocessingml/);
  assert.throws(() => validateApprovalFile('申请.xlsx', bytes));
  assert.match(validateApprovalFile('工资.xlsx', zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' })), /spreadsheetml/);
});
test('rejects external relations, macros, embedded packages and XML entities', () => {
  for (const extra of [{ 'word/_rels/document.xml.rels': '<Relationship TargetMode="External" Target="file:///secret"/>' }, { 'word/vbaProject.bin': 'macro' }, { 'word/embeddings/oleObject.bin': 'ole' }, { 'word/document.xml': '<!DOCTYPE x SYSTEM "file:///secret"><document/>' }]) {
    assert.throws(() => validateApprovalFile('申请.docx', zip({ ...base, ...extra })));
  }
});
test('rejects an inflated-size attack, corrupt archive and oversized entry count', () => {
  const bytes = zip(base); const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  const inflated = Buffer.from(bytes); inflated.writeUInt32LE(60 * 1024 * 1024, central + 24); assert.throws(() => validateApprovalFile('申请.docx', inflated));
  const crowded = Buffer.from(bytes); crowded.writeUInt16LE(1001, crowded.length - 12); assert.throws(() => validateApprovalFile('申请.docx', crowded));
  assert.throws(() => validateApprovalFile('申请.docx', bytes.subarray(0, bytes.length - 25)));
});
