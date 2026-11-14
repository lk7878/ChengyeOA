export const retiredSources = ['SOP_TASKS', 'QUALITY_ANALYSES', 'QUALITY_REVIEWS', 'QUALITY_ISSUES'];
export const retiredReviewTypes = ['SOP_REVIEW', 'QUALITY_ANALYSIS'];
export const deliveryModulesEnabled = false;
export function retiredPermission(code: string) {
  return /^(sop\.|quality\.|menu\.(quality|sop_tasks|sop_templates)$)/.test(code);
}
