import { createHash } from 'node:crypto';

import { canonicalJson } from '../admin-governance/canonical-json';
import {
  GOVERNED_OPERATION_TYPES,
  GovernanceRisk,
  GovernanceStatus,
} from '../admin-governance/governance-types';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ContractStatus,
  ContractType,
} from '../contract/contract-policy';
import {
  APPOINTMENT_STATUS,
  AppointmentStatus,
  LEAD_POOL_ACTIONS,
  LEAD_STATUS,
  LeadPoolAction,
  LeadStatus,
  POOL_STATUS,
  PoolStatus,
} from '../crm/lead-policy';
import {
  COST_CATEGORIES,
  CostCategory,
  InvoiceStatus,
  REFUND_REQUEST_TYPES,
  RefundRequestStatus,
  RefundRequestType,
} from '../finance/finance-types';
import {
  AdminOperationReviewedV1,
  ApprovalInstanceCompletedV1,
  ApprovalInstanceCreatedV1,
  AppointmentCreatedV1,
  AppointmentVisitedV1,
  CONTRACT_SOURCE_TYPES,
  CUSTOMER_STATUS,
  ContractCreatedV1,
  ContractEffectiveV1,
  ContractStatusChangedV1,
  CostCreatedV1,
  CostDeletedV1,
  CostUpdatedV1,
  CustomerCreatedV1,
  CustomerStatus,
  EventEnvelopeInput,
  InvoiceApprovedV1,
  InvoiceCompletedV1,
  InvoiceRejectedV1,
  InvoiceRequestedV1,
  LeadAssignedV1,
  LeadCreatedV1,
  LeadStatusChangedV1,
  NEGOTIATION_STATUS,
  NegotiationClosedV1,
  NegotiationCreatedV1,
  NegotiationStatus,
  PAYMENT_STATUS,
  PaymentConfirmedV1,
  PaymentCreatedV1,
  PaymentPlanCancelledV1,
  PaymentStatus,
  PaymentVoidedV1,
  RefundApprovedV1,
  RefundExecutedV1,
  RefundRejectedV1,
  RefundRequestedV1,
  RegisteredEvent,
} from './event-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const FORBIDDEN_FIELD_NAMES = new Set([
  'password', 'secret', 'token', 'authorization', 'cookie', 'csrf', 'totp', 'mfa',
  'recoverycode', 'credential', 'encryptedsecret', 'reason', 'comment', 'oldvalues', 'newvalues',
]);
const GOVERNANCE_RISKS = new Set<GovernanceRisk>([ 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL' ]);
const GOVERNANCE_STATUSES = new Set<GovernanceStatus>([
  'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTING',
  'SUCCEEDED', 'FAILED', 'PENDING_POST_REVIEW', 'CONFIRMED', 'FLAGGED',
]);
const REVIEW_DECISIONS = new Set([ 'APPROVE', 'REJECT', 'CONFIRM', 'FLAG' ]);
const LEAD_STATUSES = new Set<string>(LEAD_STATUS);
const POOL_STATUSES = new Set<string>(POOL_STATUS);
const LEAD_POOL_ACTION_VALUES = new Set<string>(LEAD_POOL_ACTIONS);
const APPOINTMENT_STATUSES = new Set<string>(APPOINTMENT_STATUS);
const APPOINTMENT_CHANNELS = new Set([ 'ONSITE', 'ONLINE' ]);
const CUSTOMER_STATUSES = new Set<string>(CUSTOMER_STATUS);
const NEGOTIATION_STATUSES = new Set<string>(NEGOTIATION_STATUS);
/** 设计 §6.5：谈案完结仅 SIGNED/UNSIGNED 两种结局。 */
const NEGOTIATION_CLOSED_STATUSES = new Set<string>([ 'SIGNED', 'UNSIGNED' ]);
const CONTRACT_TYPE_VALUES = new Set<string>(CONTRACT_TYPES);
const CONTRACT_STATUS_VALUES = new Set<string>(CONTRACT_STATUSES);
const CONTRACT_SOURCE_TYPE_VALUES = new Set<string>(CONTRACT_SOURCE_TYPES);
const PAYMENT_STATUSES = new Set<string>(PAYMENT_STATUS);
/** 设计 §6.2：收款确认事件仅在 Payment.status=CONFIRMED 时发出。 */
const PAYMENT_CONFIRMED_STATUSES = new Set<string>([ 'CONFIRMED' ]);
/** SPEC-011：开票申请各事件发出时的钉死状态（状态机见 finance-policy）。 */
const INVOICE_REQUESTED_STATUSES = new Set<string>([ 'PENDING' ]);
const INVOICE_APPROVED_STATUSES = new Set<string>([ 'APPROVED' ]);
const INVOICE_REJECTED_STATUSES = new Set<string>([ 'REJECTED' ]);
const INVOICE_COMPLETED_STATUSES = new Set<string>([ 'COMPLETED' ]);
/** SPEC-011：退款/减免申请各事件发出时的钉死状态。 */
const REFUND_REQUESTED_STATUSES = new Set<string>([ 'PENDING' ]);
const REFUND_APPROVED_STATUSES = new Set<string>([ 'APPROVED' ]);
const REFUND_REJECTED_STATUSES = new Set<string>([ 'REJECTED' ]);
const REFUND_EXECUTED_STATUSES = new Set<string>([ 'EXECUTED' ]);
const REFUND_REQUEST_TYPE_VALUES = new Set<string>(REFUND_REQUEST_TYPES);
/** SPEC-011：作废事件仅在 Payment.status=VOIDED 时发出（receivable-service.voidPayment 产生）。 */
const PAYMENT_VOIDED_STATUSES = new Set<string>([ 'VOIDED' ]);
/** SPEC-012：终止联动——期次取消事件仅在 PaymentPlan.status=CANCELLED 时发出。 */
const PAYMENT_PLAN_CANCELLED_STATUSES = new Set<string>([ 'CANCELLED' ]);
/** SPEC-013 §4.1：审批实例事件发出时的钉死状态（状态机见 approval-policy）。 */
const APPROVAL_INSTANCE_CREATED_STATUSES = new Set<string>([ 'PENDING' ]);
const APPROVAL_INSTANCE_COMPLETED_STATUSES = new Set<string>([ 'APPROVED', 'REJECTED', 'WITHDRAWN' ]);
const COST_CATEGORY_VALUES = new Set<string>(COST_CATEGORIES);

interface EventDefinition<TPayload> {
  readonly sourceModule: string;
  readonly objectType: string;
  readonly filterFields: ReadonlySet<string>;
  parsePayload(payload: unknown): TPayload;
  extractObjectId(parsed: TPayload): string;
}

const reviewedV1Definition: EventDefinition<AdminOperationReviewedV1> = {
  sourceModule: 'ADMIN_GOVERNANCE',
  objectType: 'ADMIN_OPERATION',
  filterFields: new Set([ 'operationType', 'riskLevel', 'decision', 'status', 'requesterUserId' ]),
  parsePayload(payload: unknown): AdminOperationReviewedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'operationId', 'operationType', 'riskLevel', 'decision', 'status', 'requesterUserId', 'routeUrl',
    ], 'admin.operation.reviewed v1 payload');

    const operationId = requireUuid(record.operationId, 'operationId');
    const requesterUserId = requireUuid(record.requesterUserId, 'requesterUserId');
    const operationType = requireString(record.operationType, 'operationType');
    const riskLevel = requireString(record.riskLevel, 'riskLevel');
    const decision = requireString(record.decision, 'decision');
    const status = requireString(record.status, 'status');
    const routeUrl = requireString(record.routeUrl, 'routeUrl');

    if (!GOVERNED_OPERATION_TYPES.includes(operationType as typeof GOVERNED_OPERATION_TYPES[number])) {
      throw new TypeError('operationType is not governed');
    }
    if (!GOVERNANCE_RISKS.has(riskLevel as GovernanceRisk)) throw new TypeError('riskLevel is invalid');
    if (!REVIEW_DECISIONS.has(decision)) throw new TypeError('decision is invalid');
    if (!GOVERNANCE_STATUSES.has(status as GovernanceStatus)) throw new TypeError('status is invalid');
    if (routeUrl.length > 500 || routeUrl !== `/security/admin-governance?operationId=${operationId}`) {
      throw new TypeError('routeUrl must be the server-owned governance route');
    }

    return {
      operationId,
      operationType: operationType as AdminOperationReviewedV1['operationType'],
      riskLevel: riskLevel as GovernanceRisk,
      decision: decision as AdminOperationReviewedV1['decision'],
      status: status as GovernanceStatus,
      requesterUserId,
      routeUrl,
    };
  },
  extractObjectId(parsed: AdminOperationReviewedV1): string {
    return parsed.operationId;
  },
};

const leadCreatedV1Definition: EventDefinition<LeadCreatedV1> = {
  sourceModule: 'CRM',
  objectType: 'LEAD',
  filterFields: new Set([ 'status', 'poolStatus', 'channelId' ]),
  parsePayload(payload: unknown): LeadCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'leadId', 'status', 'poolStatus', 'channelId' ], 'lead.created v1 payload');

    const leadId = requireUuid(record.leadId, 'leadId');
    const status = requireString(record.status, 'status');
    const poolStatus = requireString(record.poolStatus, 'poolStatus');
    const channelId = requireNullableUuid(record.channelId, 'channelId');

    if (!LEAD_STATUSES.has(status)) throw new TypeError('status is invalid');
    if (!POOL_STATUSES.has(poolStatus)) throw new TypeError('poolStatus is invalid');

    return {
      leadId,
      status: status as LeadStatus,
      poolStatus: poolStatus as PoolStatus,
      channelId,
    };
  },
  extractObjectId(parsed: LeadCreatedV1): string {
    return parsed.leadId;
  },
};

const leadAssignedV1Definition: EventDefinition<LeadAssignedV1> = {
  sourceModule: 'CRM',
  objectType: 'LEAD',
  filterFields: new Set([ 'action', 'fromEmployeeId', 'toEmployeeId' ]),
  parsePayload(payload: unknown): LeadAssignedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'leadId', 'action', 'fromEmployeeId', 'toEmployeeId' ], 'lead.assigned v1 payload');

    const leadId = requireUuid(record.leadId, 'leadId');
    const action = requireString(record.action, 'action');
    const fromEmployeeId = requireNullableUuid(record.fromEmployeeId, 'fromEmployeeId');
    const toEmployeeId = requireNullableUuid(record.toEmployeeId, 'toEmployeeId');

    if (!LEAD_POOL_ACTION_VALUES.has(action)) throw new TypeError('action is invalid');

    return {
      leadId,
      action: action as LeadPoolAction,
      fromEmployeeId,
      toEmployeeId,
    };
  },
  extractObjectId(parsed: LeadAssignedV1): string {
    return parsed.leadId;
  },
};

const leadStatusChangedV1Definition: EventDefinition<LeadStatusChangedV1> = {
  sourceModule: 'CRM',
  objectType: 'LEAD',
  filterFields: new Set([ 'fromStatus', 'toStatus' ]),
  parsePayload(payload: unknown): LeadStatusChangedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'leadId', 'fromStatus', 'toStatus' ], 'lead.status_changed v1 payload');

    const leadId = requireUuid(record.leadId, 'leadId');
    const fromStatus = requireString(record.fromStatus, 'fromStatus');
    const toStatus = requireString(record.toStatus, 'toStatus');

    if (!LEAD_STATUSES.has(fromStatus)) throw new TypeError('fromStatus is invalid');
    if (!LEAD_STATUSES.has(toStatus)) throw new TypeError('toStatus is invalid');

    return {
      leadId,
      fromStatus: fromStatus as LeadStatus,
      toStatus: toStatus as LeadStatus,
    };
  },
  extractObjectId(parsed: LeadStatusChangedV1): string {
    return parsed.leadId;
  },
};

const appointmentCreatedV1Definition: EventDefinition<AppointmentCreatedV1> = {
  sourceModule: 'CRM',
  objectType: 'APPOINTMENT',
  filterFields: new Set([ 'channel', 'status', 'leadId' ]),
  parsePayload(payload: unknown): AppointmentCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'appointmentId', 'leadId', 'channel', 'status' ], 'appointment.created v1 payload');

    const appointmentId = requireUuid(record.appointmentId, 'appointmentId');
    const leadId = requireUuid(record.leadId, 'leadId');
    const channel = requireString(record.channel, 'channel');
    const status = requireString(record.status, 'status');

    if (!APPOINTMENT_CHANNELS.has(channel)) throw new TypeError('channel is invalid');
    if (!APPOINTMENT_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      appointmentId,
      leadId,
      channel: channel as AppointmentCreatedV1['channel'],
      status: status as AppointmentStatus,
    };
  },
  extractObjectId(parsed: AppointmentCreatedV1): string {
    return parsed.appointmentId;
  },
};

const appointmentVisitedV1Definition: EventDefinition<AppointmentVisitedV1> = {
  sourceModule: 'CRM',
  objectType: 'APPOINTMENT',
  filterFields: new Set([ 'status', 'leadId' ]),
  parsePayload(payload: unknown): AppointmentVisitedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'appointmentId', 'leadId', 'status' ], 'appointment.visited v1 payload');

    const appointmentId = requireUuid(record.appointmentId, 'appointmentId');
    const leadId = requireUuid(record.leadId, 'leadId');
    const status = requireString(record.status, 'status');

    if (!APPOINTMENT_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      appointmentId,
      leadId,
      status: status as AppointmentStatus,
    };
  },
  extractObjectId(parsed: AppointmentVisitedV1): string {
    return parsed.appointmentId;
  },
};

const customerCreatedV1Definition: EventDefinition<CustomerCreatedV1> = {
  sourceModule: 'CRM',
  objectType: 'CUSTOMER',
  filterFields: new Set([ 'status', 'sourceLeadId' ]),
  parsePayload(payload: unknown): CustomerCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'customerId', 'sourceLeadId', 'status' ], 'customer.created v1 payload');

    const customerId = requireUuid(record.customerId, 'customerId');
    const sourceLeadId = requireNullableUuid(record.sourceLeadId, 'sourceLeadId');
    const status = requireString(record.status, 'status');

    if (!CUSTOMER_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      customerId,
      sourceLeadId,
      status: status as CustomerStatus,
    };
  },
  extractObjectId(parsed: CustomerCreatedV1): string {
    return parsed.customerId;
  },
};

const negotiationCreatedV1Definition: EventDefinition<NegotiationCreatedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'NEGOTIATION',
  filterFields: new Set([ 'status', 'customerId', 'negotiatorEmployeeId' ]),
  parsePayload(payload: unknown): NegotiationCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'negotiationId', 'customerId', 'negotiatorEmployeeId', 'status',
    ], 'negotiation.created v1 payload');

    const negotiationId = requireUuid(record.negotiationId, 'negotiationId');
    const customerId = requireUuid(record.customerId, 'customerId');
    const negotiatorEmployeeId = requireUuid(record.negotiatorEmployeeId, 'negotiatorEmployeeId');
    const status = requireString(record.status, 'status');

    if (!NEGOTIATION_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      negotiationId,
      customerId,
      negotiatorEmployeeId,
      status: status as NegotiationStatus,
    };
  },
  extractObjectId(parsed: NegotiationCreatedV1): string {
    return parsed.negotiationId;
  },
};

const negotiationClosedV1Definition: EventDefinition<NegotiationClosedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'NEGOTIATION',
  filterFields: new Set([ 'status' ]),
  parsePayload(payload: unknown): NegotiationClosedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    // 裁决：unsignedReason 不入载荷，审计查库。
    assertExactKeys(record, [ 'negotiationId', 'status' ], 'negotiation.closed v1 payload');

    const negotiationId = requireUuid(record.negotiationId, 'negotiationId');
    const status = requireString(record.status, 'status');

    if (!NEGOTIATION_CLOSED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      negotiationId,
      status: status as NegotiationStatus,
    };
  },
  extractObjectId(parsed: NegotiationClosedV1): string {
    return parsed.negotiationId;
  },
};

const contractCreatedV1Definition: EventDefinition<ContractCreatedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'CONTRACT',
  filterFields: new Set([ 'contractType', 'customerId', 'sourceType' ]),
  parsePayload(payload: unknown): ContractCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'contractId', 'contractNo', 'contractType', 'customerId', 'sourceType',
    ], 'contract.created v1 payload');

    const contractId = requireUuid(record.contractId, 'contractId');
    const contractNo = requireBusinessNo(record.contractNo, 'contractNo');
    const contractType = requireString(record.contractType, 'contractType');
    const customerId = requireUuid(record.customerId, 'customerId');
    const sourceType = requireString(record.sourceType, 'sourceType');

    if (!CONTRACT_TYPE_VALUES.has(contractType)) throw new TypeError('contractType is invalid');
    if (!CONTRACT_SOURCE_TYPE_VALUES.has(sourceType)) throw new TypeError('sourceType is invalid');

    return {
      contractId,
      contractNo,
      contractType: contractType as ContractType,
      customerId,
      sourceType: sourceType as ContractCreatedV1['sourceType'],
    };
  },
  extractObjectId(parsed: ContractCreatedV1): string {
    return parsed.contractId;
  },
};

const contractStatusChangedV1Definition: EventDefinition<ContractStatusChangedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'CONTRACT',
  filterFields: new Set([ 'fromStatus', 'toStatus' ]),
  parsePayload(payload: unknown): ContractStatusChangedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'contractId', 'fromStatus', 'toStatus' ], 'contract.status_changed v1 payload');

    const contractId = requireUuid(record.contractId, 'contractId');
    const fromStatus = requireString(record.fromStatus, 'fromStatus');
    const toStatus = requireString(record.toStatus, 'toStatus');

    if (!CONTRACT_STATUS_VALUES.has(fromStatus)) throw new TypeError('fromStatus is invalid');
    if (!CONTRACT_STATUS_VALUES.has(toStatus)) throw new TypeError('toStatus is invalid');

    return {
      contractId,
      fromStatus: fromStatus as ContractStatus,
      toStatus: toStatus as ContractStatus,
    };
  },
  extractObjectId(parsed: ContractStatusChangedV1): string {
    return parsed.contractId;
  },
};

const paymentPlanCancelledV1Definition: EventDefinition<PaymentPlanCancelledV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'PAYMENT_PLAN',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): PaymentPlanCancelledV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'planId', 'contractId', 'status' ], 'payment_plan.cancelled v1 payload');

    const planId = requireUuid(record.planId, 'planId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!PAYMENT_PLAN_CANCELLED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return { planId, contractId, status: status as 'CANCELLED' };
  },
  extractObjectId(payload: PaymentPlanCancelledV1): string {
    return payload.planId;
  },
};

const contractEffectiveV1Definition: EventDefinition<ContractEffectiveV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'CONTRACT',
  filterFields: new Set([ 'contractType', 'customerId' ]),
  parsePayload(payload: unknown): ContractEffectiveV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    // 裁决：6 键固定；caseId/engagementId 允许 null 值占位（requireNullableUuid 先例）。
    assertExactKeys(record, [
      'contractId', 'contractType', 'customerId', 'planCount', 'caseId', 'engagementId',
    ], 'contract.effective v1 payload');

    const contractId = requireUuid(record.contractId, 'contractId');
    const contractType = requireString(record.contractType, 'contractType');
    const customerId = requireUuid(record.customerId, 'customerId');
    const planCount = requireNonNegativeInteger(record.planCount, 'planCount');
    const caseId = requireNullableUuid(record.caseId, 'caseId');
    const engagementId = requireNullableUuid(record.engagementId, 'engagementId');

    if (!CONTRACT_TYPE_VALUES.has(contractType)) throw new TypeError('contractType is invalid');

    return {
      contractId,
      contractType: contractType as ContractType,
      customerId,
      planCount,
      caseId,
      engagementId,
    };
  },
  extractObjectId(parsed: ContractEffectiveV1): string {
    return parsed.contractId;
  },
};

const paymentCreatedV1Definition: EventDefinition<PaymentCreatedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'PAYMENT',
  filterFields: new Set([ 'status', 'contractId', 'customerId' ]),
  parsePayload(payload: unknown): PaymentCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'paymentId', 'paymentNo', 'contractId', 'customerId', 'status',
    ], 'payment.created v1 payload');

    const paymentId = requireUuid(record.paymentId, 'paymentId');
    const paymentNo = requireBusinessNo(record.paymentNo, 'paymentNo');
    const contractId = requireUuid(record.contractId, 'contractId');
    const customerId = requireUuid(record.customerId, 'customerId');
    const status = requireString(record.status, 'status');

    if (!PAYMENT_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      paymentId,
      paymentNo,
      contractId,
      customerId,
      status: status as PaymentStatus,
    };
  },
  extractObjectId(parsed: PaymentCreatedV1): string {
    return parsed.paymentId;
  },
};

const paymentConfirmedV1Definition: EventDefinition<PaymentConfirmedV1> = {
  sourceModule: 'CONTRACT',
  objectType: 'PAYMENT',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): PaymentConfirmedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'paymentId', 'contractId', 'status' ], 'payment.confirmed v1 payload');

    const paymentId = requireUuid(record.paymentId, 'paymentId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!PAYMENT_CONFIRMED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      paymentId,
      contractId,
      status: status as PaymentStatus,
    };
  },
  extractObjectId(parsed: PaymentConfirmedV1): string {
    return parsed.paymentId;
  },
};

const invoiceRequestedV1Definition: EventDefinition<InvoiceRequestedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'INVOICE_REQUEST',
  filterFields: new Set([ 'status', 'contractId', 'customerId' ]),
  parsePayload(payload: unknown): InvoiceRequestedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'invoiceRequestId', 'requestNo', 'contractId', 'customerId', 'status',
    ], 'invoice.requested v1 payload');

    const invoiceRequestId = requireUuid(record.invoiceRequestId, 'invoiceRequestId');
    const requestNo = requireBusinessNo(record.requestNo, 'requestNo');
    const contractId = requireUuid(record.contractId, 'contractId');
    const customerId = requireUuid(record.customerId, 'customerId');
    const status = requireString(record.status, 'status');

    if (!INVOICE_REQUESTED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      invoiceRequestId,
      requestNo,
      contractId,
      customerId,
      status: status as InvoiceStatus,
    };
  },
  extractObjectId(parsed: InvoiceRequestedV1): string {
    return parsed.invoiceRequestId;
  },
};

const invoiceApprovedV1Definition: EventDefinition<InvoiceApprovedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'INVOICE_REQUEST',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): InvoiceApprovedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'invoiceRequestId', 'contractId', 'status' ], 'invoice.approved v1 payload');

    const invoiceRequestId = requireUuid(record.invoiceRequestId, 'invoiceRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!INVOICE_APPROVED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      invoiceRequestId,
      contractId,
      status: status as InvoiceStatus,
    };
  },
  extractObjectId(parsed: InvoiceApprovedV1): string {
    return parsed.invoiceRequestId;
  },
};

const invoiceRejectedV1Definition: EventDefinition<InvoiceRejectedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'INVOICE_REQUEST',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): InvoiceRejectedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'invoiceRequestId', 'contractId', 'status' ], 'invoice.rejected v1 payload');

    const invoiceRequestId = requireUuid(record.invoiceRequestId, 'invoiceRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!INVOICE_REJECTED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      invoiceRequestId,
      contractId,
      status: status as InvoiceStatus,
    };
  },
  extractObjectId(parsed: InvoiceRejectedV1): string {
    return parsed.invoiceRequestId;
  },
};

const invoiceCompletedV1Definition: EventDefinition<InvoiceCompletedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'INVOICE_REQUEST',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): InvoiceCompletedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'invoiceRequestId', 'contractId', 'status' ], 'invoice.completed v1 payload');

    const invoiceRequestId = requireUuid(record.invoiceRequestId, 'invoiceRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!INVOICE_COMPLETED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      invoiceRequestId,
      contractId,
      status: status as InvoiceStatus,
    };
  },
  extractObjectId(parsed: InvoiceCompletedV1): string {
    return parsed.invoiceRequestId;
  },
};

const refundRequestedV1Definition: EventDefinition<RefundRequestedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'REFUND_REQUEST',
  filterFields: new Set([ 'status', 'type', 'contractId', 'customerId' ]),
  parsePayload(payload: unknown): RefundRequestedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'refundRequestId', 'requestNo', 'type', 'contractId', 'customerId', 'status',
    ], 'refund.requested v1 payload');

    const refundRequestId = requireUuid(record.refundRequestId, 'refundRequestId');
    const requestNo = requireBusinessNo(record.requestNo, 'requestNo');
    const type = requireString(record.type, 'type');
    const contractId = requireUuid(record.contractId, 'contractId');
    const customerId = requireUuid(record.customerId, 'customerId');
    const status = requireString(record.status, 'status');

    if (!REFUND_REQUEST_TYPE_VALUES.has(type)) throw new TypeError('type is invalid');
    if (!REFUND_REQUESTED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      refundRequestId,
      requestNo,
      type: type as RefundRequestType,
      contractId,
      customerId,
      status: status as RefundRequestStatus,
    };
  },
  extractObjectId(parsed: RefundRequestedV1): string {
    return parsed.refundRequestId;
  },
};

const refundApprovedV1Definition: EventDefinition<RefundApprovedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'REFUND_REQUEST',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): RefundApprovedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'refundRequestId', 'contractId', 'status' ], 'refund.approved v1 payload');

    const refundRequestId = requireUuid(record.refundRequestId, 'refundRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!REFUND_APPROVED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      refundRequestId,
      contractId,
      status: status as RefundRequestStatus,
    };
  },
  extractObjectId(parsed: RefundApprovedV1): string {
    return parsed.refundRequestId;
  },
};

const refundRejectedV1Definition: EventDefinition<RefundRejectedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'REFUND_REQUEST',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): RefundRejectedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'refundRequestId', 'contractId', 'status' ], 'refund.rejected v1 payload');

    const refundRequestId = requireUuid(record.refundRequestId, 'refundRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!REFUND_REJECTED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      refundRequestId,
      contractId,
      status: status as RefundRequestStatus,
    };
  },
  extractObjectId(parsed: RefundRejectedV1): string {
    return parsed.refundRequestId;
  },
};

const refundExecutedV1Definition: EventDefinition<RefundExecutedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'REFUND_REQUEST',
  filterFields: new Set([ 'status', 'contractId', 'paymentId', 'planId' ]),
  parsePayload(payload: unknown): RefundExecutedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    // 可空锚点 paymentId/planId 一实一空（REFUND 锚 paymentId、WAIVER 锚 planId），允许 null 值占位；
    // 锚点与 type 的一致性由服务层裁决，注册表只钉形态。
    assertExactKeys(record, [
      'refundRequestId', 'contractId', 'paymentId', 'planId', 'status',
    ], 'refund.executed v1 payload');

    const refundRequestId = requireUuid(record.refundRequestId, 'refundRequestId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const paymentId = requireNullableUuid(record.paymentId, 'paymentId');
    const planId = requireNullableUuid(record.planId, 'planId');
    const status = requireString(record.status, 'status');

    if (!REFUND_EXECUTED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      refundRequestId,
      contractId,
      paymentId,
      planId,
      status: status as RefundRequestStatus,
    };
  },
  extractObjectId(parsed: RefundExecutedV1): string {
    return parsed.refundRequestId;
  },
};

const paymentVoidedV1Definition: EventDefinition<PaymentVoidedV1> = {
  // 裁决：payment.voided 由 receivable-service.voidPayment 产生，与 payment.created/confirmed
  // 同族同模块，sourceModule 用 'CONTRACT' 而非 'FINANCE'。
  sourceModule: 'CONTRACT',
  objectType: 'PAYMENT',
  filterFields: new Set([ 'status', 'contractId' ]),
  parsePayload(payload: unknown): PaymentVoidedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'paymentId', 'contractId', 'status' ], 'payment.voided v1 payload');

    const paymentId = requireUuid(record.paymentId, 'paymentId');
    const contractId = requireUuid(record.contractId, 'contractId');
    const status = requireString(record.status, 'status');

    if (!PAYMENT_VOIDED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      paymentId,
      contractId,
      status: status as PaymentStatus,
    };
  },
  extractObjectId(parsed: PaymentVoidedV1): string {
    return parsed.paymentId;
  },
};

const costCreatedV1Definition: EventDefinition<CostCreatedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'COST_ENTRY',
  filterFields: new Set([ 'category', 'channelId', 'caseId' ]),
  parsePayload(payload: unknown): CostCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    // 可空锚点 channelId/caseId 一空一实或均空，允许 null 值占位；
    // 锚点矩阵（设计 §5.3，CHANNEL→channelId 必填等）由 finance-policy 裁决，注册表只钉形态。
    assertExactKeys(record, [ 'costEntryId', 'category', 'channelId', 'caseId' ], 'cost.created v1 payload');

    const costEntryId = requireUuid(record.costEntryId, 'costEntryId');
    const category = requireString(record.category, 'category');
    const channelId = requireNullableUuid(record.channelId, 'channelId');
    const caseId = requireNullableUuid(record.caseId, 'caseId');

    if (!COST_CATEGORY_VALUES.has(category)) throw new TypeError('category is invalid');

    return {
      costEntryId,
      category: category as CostCategory,
      channelId,
      caseId,
    };
  },
  extractObjectId(parsed: CostCreatedV1): string {
    return parsed.costEntryId;
  },
};

const costUpdatedV1Definition: EventDefinition<CostUpdatedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'COST_ENTRY',
  filterFields: new Set([ 'category' ]),
  parsePayload(payload: unknown): CostUpdatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'costEntryId', 'category' ], 'cost.updated v1 payload');

    const costEntryId = requireUuid(record.costEntryId, 'costEntryId');
    const category = requireString(record.category, 'category');

    if (!COST_CATEGORY_VALUES.has(category)) throw new TypeError('category is invalid');

    return {
      costEntryId,
      category: category as CostCategory,
    };
  },
  extractObjectId(parsed: CostUpdatedV1): string {
    return parsed.costEntryId;
  },
};

const costDeletedV1Definition: EventDefinition<CostDeletedV1> = {
  sourceModule: 'FINANCE',
  objectType: 'COST_ENTRY',
  filterFields: new Set([ 'category' ]),
  parsePayload(payload: unknown): CostDeletedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'costEntryId', 'category' ], 'cost.deleted v1 payload');

    const costEntryId = requireUuid(record.costEntryId, 'costEntryId');
    const category = requireString(record.category, 'category');

    if (!COST_CATEGORY_VALUES.has(category)) throw new TypeError('category is invalid');

    return {
      costEntryId,
      category: category as CostCategory,
    };
  },
  extractObjectId(parsed: CostDeletedV1): string {
    return parsed.costEntryId;
  },
};

const approvalInstanceCreatedV1Definition: EventDefinition<ApprovalInstanceCreatedV1> = {
  sourceModule: 'APPROVAL',
  objectType: 'APPROVAL_INSTANCE',
  filterFields: new Set([ 'businessType', 'title', 'applicantId', 'status' ]),
  parsePayload(payload: unknown): ApprovalInstanceCreatedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [
      'instanceId', 'businessType', 'title', 'applicantId', 'status',
    ], 'approval.instance.created v1 payload');

    const instanceId = requireUuid(record.instanceId, 'instanceId');
    const businessType = requireString(record.businessType, 'businessType');
    const title = requireString(record.title, 'title');
    const applicantId = requireUuid(record.applicantId, 'applicantId');
    const status = requireString(record.status, 'status');

    if (!APPROVAL_INSTANCE_CREATED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      instanceId,
      businessType,
      title,
      applicantId,
      status: status as 'PENDING',
    };
  },
  extractObjectId(parsed: ApprovalInstanceCreatedV1): string {
    return parsed.instanceId;
  },
};

const approvalInstanceCompletedV1Definition: EventDefinition<ApprovalInstanceCompletedV1> = {
  sourceModule: 'APPROVAL',
  objectType: 'APPROVAL_INSTANCE',
  filterFields: new Set([ 'businessType', 'status' ]),
  parsePayload(payload: unknown): ApprovalInstanceCompletedV1 {
    assertSafeJson(payload);
    assertPayloadSize(payload);
    const record = requirePlainObject(payload, 'Event payload');
    assertExactKeys(record, [ 'instanceId', 'businessType', 'status' ], 'approval.instance.completed v1 payload');

    const instanceId = requireUuid(record.instanceId, 'instanceId');
    const businessType = requireString(record.businessType, 'businessType');
    const status = requireString(record.status, 'status');

    if (!APPROVAL_INSTANCE_COMPLETED_STATUSES.has(status)) throw new TypeError('status is invalid');

    return {
      instanceId,
      businessType,
      status: status as ApprovalInstanceCompletedV1['status'],
    };
  },
  extractObjectId(parsed: ApprovalInstanceCompletedV1): string {
    return parsed.instanceId;
  },
};

const collaborationChanged: EventDefinition<{ baseId: string }> = {
  sourceModule: 'COLLABORATION', objectType: 'COLLAB_BASE', filterFields: new Set(),
  parsePayload(payload: unknown) { const value = requirePlainObject(payload, 'Collaboration event'); assertExactKeys(value, ['baseId'], 'Collaboration event'); return { baseId: requireUuid(value.baseId, 'baseId') }; },
  extractObjectId(payload) { return payload.baseId; },
};

function sopChangedDefinition(objectType: 'SOP_INSTANCE' | 'SOP_TASK'): EventDefinition<{id:string;version:number;action:string}> {
 return {sourceModule:'SOP',objectType,filterFields:new Set(['action']),parsePayload(raw:unknown){
  assertSafeJson(raw);assertPayloadSize(raw);const value=requirePlainObject(raw,'SOP event');assertExactKeys(value,['id','version','action'],'SOP event');
  const version=requireNonNegativeInteger(value.version,'version');if(version<1)throw new Error('SOP event version must be positive');
  const action=requireString(value.action,'action');if(!['START','COMPLETE','PAUSE','RESUME','CANCEL','SKIP','ASSIGN','RESCHEDULE'].includes(action))throw new Error('Invalid SOP action');
  return {id:requireUuid(value.id,'id'),version,action};},extractObjectId(value){return value.id;}};
}

const EVENT_DEFINITIONS = new Map<string, EventDefinition<unknown>>([
  [eventKey('sop.instance.changed',1),sopChangedDefinition('SOP_INSTANCE')],
  [eventKey('sop.task.changed',1),sopChangedDefinition('SOP_TASK')],
  [ eventKey('collaboration.changed', 1), collaborationChanged ],
  [ eventKey('admin.operation.reviewed', 1), reviewedV1Definition ],
  [ eventKey('lead.created', 1), leadCreatedV1Definition ],
  [ eventKey('lead.assigned', 1), leadAssignedV1Definition ],
  [ eventKey('lead.status_changed', 1), leadStatusChangedV1Definition ],
  [ eventKey('appointment.created', 1), appointmentCreatedV1Definition ],
  [ eventKey('appointment.visited', 1), appointmentVisitedV1Definition ],
  [ eventKey('customer.created', 1), customerCreatedV1Definition ],
  [ eventKey('negotiation.created', 1), negotiationCreatedV1Definition ],
  [ eventKey('negotiation.closed', 1), negotiationClosedV1Definition ],
  [ eventKey('contract.created', 1), contractCreatedV1Definition ],
  [ eventKey('contract.status_changed', 1), contractStatusChangedV1Definition ],
  [ eventKey('payment_plan.cancelled', 1), paymentPlanCancelledV1Definition ],
  [ eventKey('contract.effective', 1), contractEffectiveV1Definition ],
  [ eventKey('payment.created', 1), paymentCreatedV1Definition ],
  [ eventKey('payment.confirmed', 1), paymentConfirmedV1Definition ],
  [ eventKey('invoice.requested', 1), invoiceRequestedV1Definition ],
  [ eventKey('invoice.approved', 1), invoiceApprovedV1Definition ],
  [ eventKey('invoice.rejected', 1), invoiceRejectedV1Definition ],
  [ eventKey('invoice.completed', 1), invoiceCompletedV1Definition ],
  [ eventKey('refund.requested', 1), refundRequestedV1Definition ],
  [ eventKey('refund.approved', 1), refundApprovedV1Definition ],
  [ eventKey('refund.rejected', 1), refundRejectedV1Definition ],
  [ eventKey('refund.executed', 1), refundExecutedV1Definition ],
  [ eventKey('payment.voided', 1), paymentVoidedV1Definition ],
  [ eventKey('cost.created', 1), costCreatedV1Definition ],
  [ eventKey('cost.updated', 1), costUpdatedV1Definition ],
  [ eventKey('cost.deleted', 1), costDeletedV1Definition ],
  [ eventKey('approval.instance.created', 1), approvalInstanceCreatedV1Definition ],
  [ eventKey('approval.instance.completed', 1), approvalInstanceCompletedV1Definition ],
]);

export function parseEventPayload<TPayload = unknown>(
  eventType: string,
  eventVersion: number,
  payload: unknown,
): Pick<RegisteredEvent<TPayload>, 'eventType' | 'eventVersion' | 'sourceModule' | 'objectType' | 'objectId' | 'orderingKey' | 'payload'> {
  const definition = eventDefinition(eventType, eventVersion);
  const parsedPayload = definition.parsePayload(payload) as TPayload;
  const objectId = definition.extractObjectId(parsedPayload);

  return {
    eventType,
    eventVersion,
    sourceModule: definition.sourceModule,
    objectType: definition.objectType,
    objectId,
    orderingKey: orderingKey(definition.objectType, objectId),
    payload: parsedPayload,
  };
}

export function validateEventEnvelope(input: EventEnvelopeInput): RegisteredEvent<unknown> {
  const parsed = parseEventPayload(input.eventType, input.eventVersion, input.payload);
  if (input.objectType !== parsed.objectType || input.objectId !== parsed.objectId) {
    throw new TypeError('Event envelope object does not match its registered payload');
  }
  assertNullableUuid(input.operatorUserId, 'operatorUserId');
  assertNullableUuid(input.organizationId, 'organizationId');
  assertNullableUuid(input.branchId, 'branchId');
  assertNullableUuid(input.teamId, 'teamId');
  if (typeof input.traceId !== 'string' || input.traceId.length === 0 || input.traceId.length > 200) {
    throw new TypeError('traceId must be a non-empty string of at most 200 characters');
  }
  if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
    throw new TypeError('occurredAt must be a valid UTC timestamp');
  }

  return {
    ...input,
    ...parsed,
    occurredAt: new Date(input.occurredAt.getTime()),
  };
}

export function allowedSubscriptionFields(eventType: string, eventVersion: number): ReadonlySet<string> {
  return new Set(eventDefinition(eventType, eventVersion).filterFields);
}

function eventDefinition(eventType: string, eventVersion: number): EventDefinition<unknown> {
  if (typeof eventType !== 'string' || !Number.isSafeInteger(eventVersion) || eventVersion < 1) {
    throw new TypeError('Event type and version are invalid');
  }
  const definition = EVENT_DEFINITIONS.get(eventKey(eventType, eventVersion));
  if (!definition) throw new TypeError('Event type or version is not registered');
  return definition;
}

function eventKey(eventType: string, eventVersion: number): string {
  return `${eventType}@${eventVersion}`;
}

function orderingKey(objectType: string, objectId: string): string {
  return createHash('sha256').update(`${objectType}:${objectId}`, 'utf8').digest('hex');
}

function assertPayloadSize(payload: unknown): void {
  const size = Buffer.byteLength(canonicalJson(payload), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) throw new TypeError('Event payload exceeds 16 KiB');
}

function assertSafeJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Event payload accepts only finite numbers');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('Event payload accepts only JSON values');
  if (ancestors.has(value)) throw new TypeError('Event payload does not accept cyclic values');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('Event payload does not accept sparse arrays');
        assertSafeJson(value[index], ancestors);
      }
      if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Event payload arrays may not have extra properties');
      }
      return;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Event payload accepts only plain JSON objects');
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
        throw new TypeError(`Event payload contains forbidden field ${key}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Event payload does not accept accessors');
      }
      assertSafeJson(descriptor.value, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [ ...expected ].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function requireBusinessNo(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (parsed.length === 0 || parsed.length > 100) {
    throw new TypeError(`${label} must be a non-empty string of at most 100 characters`);
  }
  return parsed;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  const parsed = requireString(value, label);
  if (!UUID_PATTERN.test(parsed)) throw new TypeError(`${label} must be a UUID`);
  return parsed;
}

function requireNullableUuid(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireUuid(value, label);
}

function assertNullableUuid(value: string | null, label: string): void {
  if (value !== null) requireUuid(value, label);
}
