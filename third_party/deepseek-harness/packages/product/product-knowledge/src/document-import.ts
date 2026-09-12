/** Host-only bounded extraction for supported knowledge source files. */

import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { convert as htmlToText } from 'html-to-text'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { KnowledgeDocumentKind } from './types.ts'
import type { PaddleOcrProvider } from './paddleocr-worker.ts'

/** Maximum decoded source-file size accepted by the browser Remote flow. */
export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024

/** Decoded and classified source file ready for persistent processing. */
export interface DecodedKnowledgeFile {
  readonly fileName: string
  readonly kind: KnowledgeDocumentKind
  readonly bytes: Uint8Array
  readonly sourceHash: string
}

/** Extracted Markdown projection ready for chunking and indexing. */
export interface ExtractedKnowledgeDocument {
  readonly markdown: string
  readonly extractedChars: number
  readonly nativePages: number
  readonly ocrPages: number
  readonly reviewBlocks: number
  readonly parserVersion: string
  readonly modelVersion: string | null
}

/** Bounded adaptive PDF extraction policy. */
export interface KnowledgeDocumentExtractionConfig {
  readonly ocr?: PaddleOcrProvider
  readonly nativeMinCharsPerPage?: number
  readonly renderWidth?: number
  readonly maxPdfPages?: number
  readonly reviewConfidence?: number
  readonly maxSpreadsheetSheets?: number
  readonly maxSpreadsheetRows?: number
  readonly maxSpreadsheetColumns?: number
}

/**
 * Decode, bound, classify, and hash one browser-provided source file.
 * @param fileNameInput - original browser-selected file name.
 * @param base64Input - base64-encoded source bytes.
 * @returns validated bytes and stable source identity.
 */
export function decodeKnowledgeFile(fileNameInput: string, base64Input: string): DecodedKnowledgeFile {
  const fileName = fileNameInput.trim()
  const kind = knowledgeDocumentKind(fileName)
  const base64 = base64Input.trim()
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const decodedSize = base64.length / 4 * 3 - padding
  if (decodedSize > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new RemoteError('knowledge/file-too-large', `Source file "${fileName}" exceeds ${MAX_KNOWLEDGE_FILE_BYTES} bytes.`, {
      fileName, maxBytes: MAX_KNOWLEDGE_FILE_BYTES,
    })
  }
  if (!isValidBase64(base64)) {
    throw new RemoteError('knowledge/invalid-base64', `Source file "${fileName}" is not valid base64.`, { fileName })
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength === 0) {
    throw new RemoteError('knowledge/invalid-base64', `Source file "${fileName}" is empty.`, { fileName })
  }
  return {
    fileName, kind, bytes,
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** Validate arbitrarily large Base64 payloads without recursive RegExp backtracking. */
function isValidBase64(source: string): boolean {
  if (source.length === 0 || source.length % 4 !== 0) return false
  const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0
  const payloadLength = source.length - padding
  for (let index = 0; index < payloadLength; index += 1) {
    const code = source.charCodeAt(index)
    const alphaNumeric = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
    if (!alphaNumeric && code !== 43 && code !== 47) return false
  }
  for (let index = payloadLength; index < source.length; index += 1) {
    if (source.charCodeAt(index) !== 61) return false
  }
  return true
}

/**
 * Extract a normalized Markdown projection from validated source bytes.
 * @param file - validated source file.
 * @param config - optional local extraction providers and resource limits.
 * @returns normalized extracted Markdown and its character count.
 */
export async function extractKnowledgeDocument(
  file: DecodedKnowledgeFile,
  config: KnowledgeDocumentExtractionConfig = {},
): Promise<ExtractedKnowledgeDocument> {
  let extracted: string
  let parserVersion: string
  let nativePages = 0
  let ocrPages = 0
  let reviewBlocks = 0
  let modelVersion: string | null = null
  switch (file.kind) {
    case 'md':
      extracted = decodeUtf8(file)
      parserVersion = 'native-markdown@1'
      break
    case 'txt':
      extracted = withTitle(file.fileName, decodeUtf8(file))
      parserVersion = 'native-text@1'
      break
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) })
      extracted = withTitle(file.fileName, result.value)
      parserVersion = 'mammoth@1.12.2'
      break
    }
    case 'html': {
      const html = decodeUtf8(file)
      extracted = withTitle(file.fileName, htmlToText(html, {
        selectors: [
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'noscript', format: 'skip' },
          { selector: 'nav', format: 'skip' },
        ],
        wordwrap: false,
      }))
      parserVersion = 'html-to-text@10.0.1'
      break
    }
    case 'xlsx': {
      extracted = await extractWorkbook(file, config)
      parserVersion = 'exceljs@4.4.0'
      break
    }
    case 'pdf': {
      const parser = new PDFParse({ data: file.bytes })
      try {
        const result = await parser.getText({ pageJoiner: '' })
        const maxPages = config.maxPdfPages ?? 200
        if (result.total > maxPages) throw new Error(`PDF has ${result.total} pages; configured maximum is ${maxPages}.`)
        const minimum = config.nativeMinCharsPerPage ?? 32
        const pages = result.pages.map(page => ({ number: page.num, text: page.text.trim() }))
        const problemPages = pages.filter(page => !hasUsableNativeText(page.text, minimum)).map(page => page.number)
        nativePages = pages.length - problemPages.length
        if (problemPages.length > 0) {
          if (config.ocr === undefined) {
            throw new Error(`PDF pages ${problemPages.join(', ')} require local OCR, but PaddleOCR is not configured.`)
          }
          const screenshots = await parser.getScreenshot({
            partial: problemPages, desiredWidth: config.renderWidth ?? 1_200,
            imageBuffer: true, imageDataUrl: false,
          })
          for (const screenshot of screenshots.pages) {
            const recognized = await config.ocr.recognize(screenshot.data, screenshot.pageNumber)
            const page = pages.find(item => item.number === screenshot.pageNumber)
            if (page === undefined) throw new Error(`Rendered OCR page ${screenshot.pageNumber} was not present in the text result.`)
            page.text = recognized.text.trim()
            modelVersion = recognized.model
            ocrPages += 1
            reviewBlocks += recognized.blocks.filter(block => block.confidence !== null
              && block.confidence < (config.reviewConfidence ?? 0.72)).length
          }
        }
        extracted = withTitle(file.fileName, pages.map(page => `## Page ${page.number}\n\n${page.text}`).join('\n\n'))
        parserVersion = 'pdf-parse@2.4.5'
      } finally {
        await parser.destroy()
      }
      break
    }
  }
  const markdown = normalizeExtracted(extracted)
  return {
    markdown, extractedChars: markdown.length, nativePages, ocrPages, reviewBlocks,
    parserVersion, modelVersion,
  }
}

/**
 * Reject empty, corrupt, and repeated-glyph pages, ignoring standalone decorative rules only for scoring.
 * @param text - native PDF page extraction.
 * @param minimumChars - minimum non-whitespace character count after decorative rules are excluded.
 * @returns whether the page can bypass OCR under the text-quality rules.
 */
export function hasUsableNativeText(text: string, minimumChars: number): boolean {
  const compact = text.replace(/^[\t ]*([_\-=─━═])(?:[\t ]*\1){2,}[\t ]*\r?$/gmu, '').replace(/\s/gu, '')
  if (compact.length < minimumChars) return false
  const useful = compact.match(/[\p{L}\p{N}\p{Script=Han}]/gu)?.length ?? 0
  const replacement = compact.match(/[\uFFFD\u0000]/gu)?.length ?? 0
  const longestRepeat = /([\s\S])\1{11,}/u.test(compact)
  return useful / compact.length >= 0.55 && replacement / compact.length <= 0.02 && !longestRepeat
}

/**
 * Render exactly one explicitly selected physical PDF page for the official image attachment path.
 * @param bytes - retained original PDF bytes.
 * @param page - one-based physical page number, never an inferred printed page.
 * @param width - configured raster width.
 * @param signal - cancellation checked before and after rendering.
 * @returns encoded PNG bytes for the full-page region.
 */
export async function renderKnowledgePage(bytes: Uint8Array, page: number, width: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid physical PDF page.')
  const parser = new PDFParse({ data: bytes })
  try {
    const result = await parser.getScreenshot({ partial: [page], desiredWidth: width, imageBuffer: true, imageDataUrl: false })
    signal.throwIfAborted()
    const image = result.pages.find(item => item.pageNumber === page)
    if (image === undefined) throw new Error('Selected PDF page does not exist.')
    return image.data
  } finally { await parser.destroy() }
}

function knowledgeDocumentKind(fileName: string): KnowledgeDocumentKind {
  const extension = /\.([^.]+)$/u.exec(fileName)?.[1]?.toLowerCase()
  if (extension === 'pdf' || extension === 'docx' || extension === 'txt' || extension === 'xlsx') return extension
  if (extension === 'md' || extension === 'markdown') return 'md'
  if (extension === 'html' || extension === 'htm') return 'html'
  throw new RemoteError('knowledge/unsupported-file-type', `Source file "${fileName}" is not a supported PDF, DOCX, XLSX, HTML, Markdown, or TXT file.`, { fileName })
}

async function extractWorkbook(
  file: DecodedKnowledgeFile,
  config: KnowledgeDocumentExtractionConfig,
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(file.bytes.slice().buffer)
  const maxSheets = config.maxSpreadsheetSheets ?? 64
  const maxRows = config.maxSpreadsheetRows ?? 100_000
  const maxColumns = config.maxSpreadsheetColumns ?? 256
  if (workbook.worksheets.length > maxSheets) {
    throw new Error(`XLSX has ${workbook.worksheets.length} worksheets; configured maximum is ${maxSheets}.`)
  }
  let rowCount = 0
  const sheets = workbook.worksheets.map((worksheet) => {
    if (worksheet.actualColumnCount > maxColumns) {
      throw new Error(`XLSX worksheet "${worksheet.name}" has ${worksheet.actualColumnCount} columns; configured maximum is ${maxColumns}.`)
    }
    const rows: Array<{ rowNumber: number; values: string[] }> = []
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      rowCount += 1
      if (rowCount > maxRows) throw new Error(`XLSX exceeds the configured maximum of ${maxRows} non-empty rows.`)
      const values = Array.from({ length: Math.min(row.cellCount, maxColumns) }, (_, index) => {
        const text = row.getCell(index + 1).text.replace(/\r?\n/gu, ' ').trim()
        return escapeMarkdownTableCell(text)
      })
      if (values.some(Boolean)) rows.push({ rowNumber, values })
    })
    if (rows.length === 0) return `## ${safeHeading(worksheet.name)}\n\n_Empty worksheet_`
    const valueColumns = Math.max(...rows.map(row => row.values.length))
    const header = `| Row | ${Array.from({ length: valueColumns }, (_, index) => `Column ${index + 1}`).join(' | ')} |`
    const divider = `| --- | ${Array.from({ length: valueColumns }, () => '---').join(' | ')} |`
    const body = rows.map((row) => {
      const cells = [...row.values, ...Array.from({ length: valueColumns - row.values.length }, () => '')]
      return `| ${row.rowNumber} | ${cells.join(' | ')} |`
    }).join('\n')
    return `## ${safeHeading(worksheet.name)}\n\n${header}\n${divider}\n${body}`
  })
  return withTitle(file.fileName, sheets.join('\n\n'))
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|')
}

function safeHeading(value: string): string {
  return value.replace(/[\r\n#]+/gu, ' ').trim() || 'Worksheet'
}

function decodeUtf8(file: DecodedKnowledgeFile): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
  } catch {
    throw new Error(`${file.kind.toUpperCase()} source is not valid UTF-8 text.`)
  }
}

function withTitle(fileName: string, content: string): string {
  const title = fileName.replace(/\.[^.]+$/u, '').replace(/[\r\n#]+/gu, ' ').trim() || 'Document'
  return `# ${title}\n\n${content}`
}

function normalizeExtracted(value: string): string {
  const markdown = value.replace(/^\uFEFF/u, '').replaceAll('\0', '').replace(/\r\n?/gu, '\n').trim()
  if (markdown.length === 0) throw new Error('Source extraction produced no text.')
  if (markdown.length > 2_000_000) throw new Error('Extracted text exceeds 2000000 characters.')
  return markdown
}
