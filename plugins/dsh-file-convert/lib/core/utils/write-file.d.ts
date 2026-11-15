/**
 * Write `data` to `target` atomically: the bytes land in a sibling temp file
 * (same volume, so rename never hits EXDEV) and are renamed over the target
 * only when complete. Windows AV scanners can hold the target briefly - those
 * lock errors are retried a few times; a persistent failure throws loudly
 * rather than degrading to a non-atomic copy.
 */
export declare function writeFileAtomic(target: string, data: Buffer | string): Promise<void>;
