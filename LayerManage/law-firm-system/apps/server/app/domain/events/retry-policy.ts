import { RetryDecision } from './event-types';

const RETRY_DELAYS_MS = [ 15_000, 300_000, 3_600_000, 21_600_000 ] as const;

export function retryDecision(attemptNumber: number): RetryDecision {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new TypeError('Event attempt number must be a positive integer');
  }

  const delayMs = RETRY_DELAYS_MS[attemptNumber - 1];
  return delayMs === undefined ? { kind: 'MANUAL' } : { kind: 'RETRY_WAIT', delayMs };
}
