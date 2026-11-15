import type { Logger } from '../core/index.js';
import type { Config } from '../config.js';
/**
 * Explicit consent path for OCR language data: downloads tesseract.js packs
 * into the plugin cache. Conversions never download these implicitly.
 */
export declare function createInstallOcrTool(config: Config, logger: Logger): import("@deepseek-ai/dsh-tools").ToolDefinition;
