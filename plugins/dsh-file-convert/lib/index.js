import { createRouter } from './core/index.js';
import { createConvertFileTool } from './tools/convert-file.js';
import { createBatchConvertTool } from './tools/batch-convert.js';
import { createInspectFileTool } from './tools/inspect-file.js';
import { createListConversionsTool } from './tools/list-conversions.js';
import { createOptimizeFileTool } from './tools/optimize-file.js';
import { createInstallMediaTool } from './tools/install-media.js';
import { createInstallOcrTool } from './tools/install-ocr.js';
export { Config } from './config.js';
// Library consumers (CLI, MCP wrapper, tests) can import the whole core
// surface from the package root; the DSH loader only reads name/inject/apply.
export * from './core/index.js';
export const name = 'dsh-file-convert';
export const inject = ['tools'];
const CONSOLE_LOGGER = {
    debug: () => { },
    info: (msg) => console.log(`[dsh-file-convert] ${msg}`),
    warn: (msg) => console.warn(`[dsh-file-convert] ${msg}`),
    error: (msg) => console.error(`[dsh-file-convert] ${msg}`),
};
export function apply(ctx, config) {
    const logger = isLogger(ctx.logger) ? ctx.logger : CONSOLE_LOGGER;
    const router = createRouter({
        quality: config.quality,
        dpi: config.dpi,
        timeoutMs: config.timeoutMs,
        outputRoots: config.outputRoots,
        binaryOverrides: {
            ...(config.ffmpegPath ? { ffmpegPath: config.ffmpegPath } : {}),
            ...(config.ffprobePath ? { ffprobePath: config.ffprobePath } : {}),
            ...(config.sofficePath ? { sofficePath: config.sofficePath } : {}),
            ...(config.ghostscriptPath ? { ghostscriptPath: config.ghostscriptPath } : {}),
            ...(config.pythonPath ? { pythonPath: config.pythonPath } : {}),
            ...(config.tesseractPath ? { tesseractPath: config.tesseractPath } : {}),
        },
        maxInputBytes: config.maxInputMb * 1024 * 1024,
        maxPdfPages: config.maxPdfPages,
        maxOutputPixels: config.maxOutputPixels,
    });
    ctx.tools.register(createConvertFileTool(router, config, logger));
    ctx.tools.register(createBatchConvertTool(router, config, logger));
    ctx.tools.register(createInspectFileTool(router, config, logger));
    ctx.tools.register(createListConversionsTool(router, logger));
    ctx.tools.register(createOptimizeFileTool(router, config, logger));
    ctx.tools.register(createInstallMediaTool(config, logger));
    ctx.tools.register(createInstallOcrTool(config, logger));
    logger.info('dsh-file-convert loaded: 7 tools registered (26 conversions; media/ocr dependencies install on request)');
}
function isLogger(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.info === 'function' &&
        typeof value.warn === 'function');
}
