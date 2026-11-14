import * as sop from '../sop/review-policy';
import * as analysis from './analysis-review-policy';
export { freezeSopReviewChecklist } from '../sop/review-policy';
// Retain the established entry names while applying both managed-business policies.
export async function sopApprovalScope(...args: Parameters<typeof sop.sopApprovalScope>) {
  return { AND: [await sop.sopApprovalScope(...args), await analysis.analysisApprovalScope(...args)] };
}
export async function guardSopApproval(...args: Parameters<typeof sop.guardSopApproval>) {
  await sop.guardSopApproval(...args);
  await analysis.guardAnalysisApproval(...args);
}
export async function lockSopApproval(...args: Parameters<typeof sop.lockSopApproval>) {
  await sop.lockSopApproval(...args);
  await analysis.lockAnalysisApproval(...args);
}
export async function syncSopReview(...args: Parameters<typeof sop.syncSopReview>) {
  return (await sop.syncSopReview(...args)) ?? (await analysis.syncAnalysisApproval(...args));
}
