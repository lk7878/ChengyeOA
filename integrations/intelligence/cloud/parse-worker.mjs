import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { LocalPaddleOcrClient } from './ocr-provider.mjs';
import { extractKnowledgeDocument } from '../dist/case-parser.mjs';

process.once('message', async ({ path, name, allowOcr }) => {
  let ocr;
  try {
    const bytes = await readFile(path); const kind = extname(name).slice(1).toLowerCase();
    if (!bytes.length || bytes.length > 200 * 1024 * 1024) throw new Error('文件超过200MB限制');
    if ((kind === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) || (['docx', 'xlsx'].includes(kind) && !bytes.subarray(0, 2).equals(Buffer.from('PK')))) throw new Error('文件内容与扩展名不匹配');
    if (allowOcr) ocr = new LocalPaddleOcrClient();
    let text;
    if (['png', 'jpg', 'jpeg', 'webp'].includes(kind)) {
      if (!ocr) throw new Error('图片需要启用服务器OCR后重试解析');
      text = (await ocr.recognize(bytes, 1)).text;
    } else text = (await extractKnowledgeDocument({ fileName: name, kind, bytes, sourceHash: createHash('sha256').update(bytes).digest('hex') }, { ocr, maxPdfPages: 500, maxSpreadsheetSheets: 20, maxSpreadsheetRows: 10000, maxSpreadsheetColumns: 100 })).markdown;
    if (!text?.trim()) throw new Error('文件未提取到可用文本');
    if (text.length > 4_000_000) throw new Error('提取文本超过400万字符，请拆分文件；原件已保留');
    process.send({ text }, () => process.exit(0));
  } catch (error) { process.send({ error: error.code === 'OCR_UNCONFIGURED' ? '服务器OCR尚未配置，原件已保留' : '解析失败，请检查文件格式、OCR配置或拆分文件后重试；原件已保留' }, () => process.exit(1)); }
  finally { ocr?.close(); }
});
