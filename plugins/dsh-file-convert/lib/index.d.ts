import type { Context } from '@deepseek-ai/cordis';
import { type Config as ConvertConfig } from './config.js';
export { Config } from './config.js';
export * from './core/index.js';
export declare const name = "dsh-file-convert";
export declare const inject: string[];
export declare function apply(ctx: Context, config: ConvertConfig): void;
