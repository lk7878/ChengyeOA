import type { Logger } from '../core/index.js';
import type { Config } from '../config.js';
/**
 * One explicit, user-approved path to media support: downloads pinned static
 * ffmpeg/ffprobe builds (FFmpeg 6.1.1) into the plugin cache via the
 * npmmirror binary CDN, with the GitHub release as a sha256-identical
 * fallback. System installs always keep priority; this only fills the gap.
 */
export declare function createInstallMediaTool(config: Config, logger: Logger): import("@deepseek-ai/dsh-tools").ToolDefinition;
