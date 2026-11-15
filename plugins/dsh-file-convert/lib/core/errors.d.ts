import type { ConvertError, ConvertErrorCode } from './types.js';
export declare function convertError(code: ConvertErrorCode, message: string, extra?: Partial<Omit<ConvertError, 'code' | 'message'>>): ConvertError;
export declare function truncate(text: string, max?: number): string;
/** Normalize an unknown thrown value into a ConvertError. */
export declare function toConvertError(err: unknown, fallbackMessage: string): ConvertError;
