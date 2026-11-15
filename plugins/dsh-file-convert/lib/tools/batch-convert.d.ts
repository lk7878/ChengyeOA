import type { ConversionRouter, Logger } from '../core/index.js';
import { DetectError } from '../core/index.js';
import type { Config } from '../config.js';
export declare function createBatchConvertTool(router: ConversionRouter, config: Config, logger: Logger): import("@deepseek-ai/dsh-tools").ToolDefinition;
export { DetectError };
