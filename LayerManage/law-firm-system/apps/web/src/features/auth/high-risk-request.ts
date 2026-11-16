import type { StepUpPurpose } from './types';
export interface HighRiskChallenge { purpose: StepUpPurpose; target: unknown; impact: string }
let handler: ((challenge: HighRiskChallenge) => Promise<string>) | null = null;
export function registerHighRiskHandler(next: NonNullable<typeof handler>) {
  handler = next;
  return () => { if (handler === next) handler = null; };
}
export function verifyHighRiskRequest(challenge: HighRiskChallenge): Promise<string> {
  return handler ? handler(challenge) : Promise.reject(new Error('STEP_UP_REQUIRED'));
}
