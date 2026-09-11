import type { Workbook, CellValue, Worksheet } from 'exceljs';
export interface TextBlock { kind: 'paragraph'; text: string }
export interface TableBlock { kind: 'table'; rows: string[][] }
export type WordBlock = TextBlock | TableBlock;

/** Local basic-content conversion, never executes imported markup. */
export async function readWord(buffer: ArrayBuffer): Promise<{ html: string; blocks: WordBlock[] }> {
  const [{ default: mammoth }, { default: purifier }] = await Promise.all([import('mammoth'), import('dompurify')]);
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, { externalFileAccess: false });
  const html = purifier.sanitize(result.value, { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'], ALLOWED_ATTR: ['colspan', 'rowspan', 'src', 'alt'] });
  const document = new DOMParser().parseFromString(html, 'text/html');
  // No remote resource requests: keep only embedded raster images.
  document.querySelectorAll('img').forEach(img => { if (!/^data:image\/(png|jpeg|webp);base64,/i.test(img.getAttribute('src') || '')) img.remove(); });
  const blocks: WordBlock[] = [];
  for (const element of Array.from(document.body.children)) {
    if (element.tagName === 'TABLE') blocks.push({ kind: 'table', rows: Array.from(element.querySelectorAll('tr')).map(row => Array.from(row.children).map(cell => cell.textContent || '')) });
    else blocks.push({ kind: 'paragraph', text: element.textContent || '' });
  }
  if (blocks.length > 2000 || blocks.reduce((sum, block) => sum + (block.kind === 'table' ? block.rows.reduce((n, row) => n + row.length, 0) : 1), 0) > 20000) throw new Error('文档内容过多，请下载原件使用 Word/WPS 编辑');
  return { html: document.body.innerHTML, blocks: blocks.length ? blocks : [{ kind: 'paragraph', text: '' }] };
}

export async function writeWord(blocks: WordBlock[]): Promise<Blob> {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType } = await import('docx');
  const paragraphs = (text: string) => text.split('\n').map(line => new Paragraph({ text: line, spacing: { after: 120 } }));
  return Packer.toBlob(new Document({ sections: [{ properties: {}, children: blocks.flatMap(block => {
    if (block.kind === 'paragraph') return paragraphs(block.text);
    const rows = block.rows.filter(row => row.length > 0);
    if (!rows.length) return [];
    return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(row => new TableRow({ children: row.map(cell => new TableCell({ children: paragraphs(cell) })) })) })] as Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>>;
  }) }] }));
}

export async function readWorkbook(buffer: ArrayBuffer): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length || workbook.worksheets.length > 30 || workbook.worksheets.some(sheet => sheet.rowCount > 5000 || sheet.columnCount > 100 || sheet.rowCount * sheet.columnCount > 100000)) throw new Error('表格超出在线编辑范围，请下载原件使用 Excel/WPS 编辑');
  return workbook;
}
export function cellText(value: CellValue, modified = false): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if ('formula' in value || 'sharedFormula' in value) return '=' + ('formula' in value ? value.formula : value.sharedFormula) + (modified ? '（待重算）' : value.result !== undefined ? `（${String(value.result)}）` : '');
  if ('richText' in value) return value.richText.map(run => run.text).join('');
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return '';
}
export function setCellText(sheet: Worksheet, row: number, column: number, text: string): void {
  const cell = sheet.getCell(row, column);
  if (cell.formula || cell.isMerged) throw new Error('公式或合并单元格请在 Excel/WPS 中修改');
  // Deliberately treat =/+/@ input as text; users cannot inject formulas through a text cell.
  cell.value = text === '' ? null : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : text;
}
export async function writeWorkbook(workbook: Workbook): Promise<Blob> {
  workbook.calcProperties.fullCalcOnLoad = true;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
