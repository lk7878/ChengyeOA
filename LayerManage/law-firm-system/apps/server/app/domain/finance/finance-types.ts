// SPEC-011 Task 3: finance 域词汇常量（纯领域层，零依赖）。

export const INVOICE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const REFUND_REQUEST_TYPES = ['REFUND', 'WAIVER'] as const;
export type RefundRequestType = (typeof REFUND_REQUEST_TYPES)[number];

export const REFUND_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

export const COST_CATEGORIES = ['CHANNEL', 'EVIDENCE', 'CASE_HANDLING', 'LABOR', 'OFFICE', 'REIMBURSEMENT'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
