import {
  GovernedOperationType,
  GovernanceRisk,
  GovernanceStatus,
} from '../admin-governance/governance-types';
import type { ContractStatus, ContractType } from '../contract/contract-policy';
import type { AppointmentStatus, LeadPoolAction, LeadStatus, PoolStatus } from '../crm/lead-policy';
import type {
  CostCategory,
  InvoiceStatus,
  RefundRequestStatus,
  RefundRequestType,
} from '../finance/finance-types';

export interface AdminOperationReviewedV1 {
  operationId: string;
  operationType: GovernedOperationType;
  riskLevel: GovernanceRisk;
  decision: 'APPROVE' | 'REJECT' | 'CONFIRM' | 'FLAG';
  status: GovernanceStatus;
  requesterUserId: string;
  routeUrl: string;
}

/** schema Customer.status 注释取值；Task 8 建 customer-policy 时可迁移。 */
export const CUSTOMER_STATUS = ['POTENTIAL', 'INTENT', 'SIGNED', 'INACTIVE'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS)[number];

export interface LeadCreatedV1 {
  leadId: string;
  status: LeadStatus;
  poolStatus: PoolStatus;
  channelId: string | null;
}

export interface LeadAssignedV1 {
  leadId: string;
  action: LeadPoolAction;
  fromEmployeeId: string | null;
  toEmployeeId: string | null;
}

export interface LeadStatusChangedV1 {
  leadId: string;
  fromStatus: LeadStatus;
  toStatus: LeadStatus;
}

export interface AppointmentCreatedV1 {
  appointmentId: string;
  leadId: string;
  channel: 'ONSITE' | 'ONLINE';
  status: AppointmentStatus;
}

export interface AppointmentVisitedV1 {
  appointmentId: string;
  leadId: string;
  status: AppointmentStatus;
}

export interface CustomerCreatedV1 {
  customerId: string;
  sourceLeadId: string | null;
  status: CustomerStatus;
}

/** schema Negotiation.status 注释取值；Task 6 建 negotiation-policy 时可迁移。 */
export const NEGOTIATION_STATUS = ['NEGOTIATING', 'SIGNED', 'UNSIGNED'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUS)[number];

/** schema Contract.sourceType 注释取值。 */
export const CONTRACT_SOURCE_TYPES = ['CUSTOMER', 'NEGOTIATION', 'ANALYSIS', 'CASE'] as const;
export type ContractSourceType = (typeof CONTRACT_SOURCE_TYPES)[number];

/** schema Payment.status 注释取值；Task 9 建 payment-policy 时可迁移。 */
export const PAYMENT_STATUS = ['PENDING', 'CONFIRMED', 'REFUNDED', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export interface NegotiationCreatedV1 {
  negotiationId: string;
  customerId: string;
  negotiatorEmployeeId: string;
  status: NegotiationStatus;
}

export interface NegotiationClosedV1 {
  negotiationId: string;
  status: NegotiationStatus;
}

export interface ContractCreatedV1 {
  contractId: string;
  contractNo: string;
  contractType: ContractType;
  customerId: string;
  sourceType: ContractSourceType;
}

export interface ContractStatusChangedV1 {
  contractId: string;
  fromStatus: ContractStatus;
  toStatus: ContractStatus;
}

export interface PaymentPlanCancelledV1 {
  planId: string;
  contractId: string;
  status: 'CANCELLED';
}

export interface ContractEffectiveV1 {
  contractId: string;
  contractType: ContractType;
  customerId: string;
  planCount: number;
  caseId: string | null;
  engagementId: string | null;
}

export interface PaymentCreatedV1 {
  paymentId: string;
  paymentNo: string;
  contractId: string;
  customerId: string;
  status: PaymentStatus;
}

export interface PaymentConfirmedV1 {
  paymentId: string;
  contractId: string;
  status: PaymentStatus;
}

export interface InvoiceRequestedV1 {
  invoiceRequestId: string;
  requestNo: string;
  contractId: string;
  customerId: string;
  status: InvoiceStatus;
}

export interface InvoiceApprovedV1 {
  invoiceRequestId: string;
  contractId: string;
  status: InvoiceStatus;
}

export interface InvoiceRejectedV1 {
  invoiceRequestId: string;
  contractId: string;
  status: InvoiceStatus;
}

export interface InvoiceCompletedV1 {
  invoiceRequestId: string;
  contractId: string;
  status: InvoiceStatus;
}

export interface RefundRequestedV1 {
  refundRequestId: string;
  requestNo: string;
  type: RefundRequestType;
  contractId: string;
  customerId: string;
  status: RefundRequestStatus;
}

export interface RefundApprovedV1 {
  refundRequestId: string;
  contractId: string;
  status: RefundRequestStatus;
}

export interface RefundRejectedV1 {
  refundRequestId: string;
  contractId: string;
  status: RefundRequestStatus;
}

export interface RefundExecutedV1 {
  refundRequestId: string;
  contractId: string;
  paymentId: string | null;
  planId: string | null;
  status: RefundRequestStatus;
}

export interface PaymentVoidedV1 {
  paymentId: string;
  contractId: string;
  status: PaymentStatus;
}

export interface CostCreatedV1 {
  costEntryId: string;
  category: CostCategory;
  channelId: string | null;
  caseId: string | null;
}

export interface CostUpdatedV1 {
  costEntryId: string;
  category: CostCategory;
}

export interface CostDeletedV1 {
  costEntryId: string;
  category: CostCategory;
}

/** SPEC-013 §4.1：apply 提交时发出，status 钉死 PENDING。 */
export interface ApprovalInstanceCreatedV1 {
  instanceId: string;
  businessType: string;
  title: string;
  applicantId: string;
  status: 'PENDING';
}

/** SPEC-013 §4.1：定稿/撤回时发出，status 钉死 APPROVED|REJECTED|WITHDRAWN。 */
export interface ApprovalInstanceCompletedV1 {
  instanceId: string;
  businessType: string;
  status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
}

export interface EventEnvelopeInput {
  eventType: string;
  eventVersion: number;
  objectType: string;
  objectId: string;
  operatorUserId: string | null;
  organizationId: string | null;
  branchId: string | null;
  teamId: string | null;
  payload: unknown;
  traceId: string;
  occurredAt: Date;
}

export interface RegisteredEvent<TPayload = unknown> extends Omit<EventEnvelopeInput, 'payload'> {
  sourceModule: string;
  orderingKey: string;
  payload: TPayload;
}

export interface SubscriptionFilter {
  all: Array<{
    field: string;
    operator: 'EQ' | 'IN';
    values: Array<string | number | boolean>;
  }>;
}

export type RetryDecision =
  | { kind: 'RETRY_WAIT'; delayMs: number }
  | { kind: 'MANUAL' };

// Event type identifiers (string constants). Payload definitions for these types
// are registered in event-registry.ts (Task 4.5); handler registration belongs to Task 9.
export const LEAD_CREATED = 'lead.created';
export const LEAD_ASSIGNED = 'lead.assigned';
export const LEAD_STATUS_CHANGED = 'lead.status_changed';
export const APPOINTMENT_CREATED = 'appointment.created';
export const APPOINTMENT_VISITED = 'appointment.visited';
export const CUSTOMER_CREATED = 'customer.created';
export const NEGOTIATION_CREATED = 'negotiation.created';
export const NEGOTIATION_CLOSED = 'negotiation.closed';
export const CONTRACT_CREATED = 'contract.created';
export const CONTRACT_STATUS_CHANGED = 'contract.status_changed';
export const CONTRACT_EFFECTIVE = 'contract.effective';
export const PAYMENT_CREATED = 'payment.created';
export const PAYMENT_CONFIRMED = 'payment.confirmed';
export const INVOICE_REQUESTED = 'invoice.requested';
export const INVOICE_APPROVED = 'invoice.approved';
export const INVOICE_REJECTED = 'invoice.rejected';
export const INVOICE_COMPLETED = 'invoice.completed';
export const REFUND_REQUESTED = 'refund.requested';
export const REFUND_APPROVED = 'refund.approved';
export const REFUND_REJECTED = 'refund.rejected';
export const REFUND_EXECUTED = 'refund.executed';
export const PAYMENT_VOIDED = 'payment.voided';
export const PAYMENT_PLAN_CANCELLED = 'payment_plan.cancelled';
export const COST_CREATED = 'cost.created';
export const COST_UPDATED = 'cost.updated';
export const COST_DELETED = 'cost.deleted';
export const APPROVAL_INSTANCE_CREATED = 'approval.instance.created';
export const APPROVAL_INSTANCE_COMPLETED = 'approval.instance.completed';
