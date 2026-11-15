/**
 * dsh-file-convert core: a DSH-independent conversion library.
 * Usable directly from tests, a CLI, or an MCP server - no harness required.
 */
export * from './types.js';
export { FORMATS, FORMAT_IDS, formatFromExtension, parseFormatArg, canonicalExtension, formatCategory } from './formats.js';
export { ConversionRouter, type RouterDefaults, type ConvertFileRequest, type ConvertRunContext } from './router.js';
export { detectFile, DetectError, type DetectOutcome } from './detect.js';
export { resolveBinary } from './binary.js';
export { defaultOutputPath, batchOutputPath } from './paths.js';
export { isInsideAnyRoot, isInsideRoot, isSameFile, realPathBestEffort } from './utils/path-guard.js';
export { writeFileAtomic } from './utils/write-file.js';
export { ImageConverter } from './converters/image.js';
export { PdfConverter } from './converters/pdf.js';
export { DataConverter } from './converters/data.js';
export { MediaConverter, FFMPEG, FFPROBE } from './converters/media.js';
export { OfficeConverter, PdfToDocxConverter, SOFFICE, PYTHON_PDF2DOCX } from './converters/office.js';
export { GHOSTSCRIPT } from './optimizers.js';
export { TESSERACT, OCR_LANGUAGE_DATA, ocrLanguagesCached, installOcrLanguages, tessdataDir, resolveOcrEngine, type OcrEngine } from './ocr.js';
export { parsePageRange, PageRangeError } from './utils/pages.js';
export { optimizeFile, type OptimizeResult } from './optimizers.js';
import { ConversionRouter, type RouterDefaults } from './router.js';
/**
 * Assemble the registry: image (sharp), pdf (pdfjs), data (yaml/csv),
 * media (ffmpeg), office (LibreOffice), pdf→docx (python pdf2docx).
 */
export declare function createRouter(defaults?: Partial<RouterDefaults>): ConversionRouter;
