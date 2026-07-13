export const TABLE_ORDER = [
  'Organization', 'Position', 'Employee', 'User', 'Role', 'Permission',
  'UserRole', 'RolePermission', 'LoginLog', 'Channel', 'Lead', 'LeadFollow',
  'Customer', 'Contract', 'Payment', 'Case', 'CaseTask', 'Communication',
  'Performance', 'Approval', 'Notification', 'OperationLog',
] as const;

export type TableName = (typeof TABLE_ORDER)[number];

export const BUSINESS_KEYS: Partial<Record<TableName, string[]>> = {
  Employee: ['employeeNo'],
  User: ['username'],
  Permission: ['code'],
  Contract: ['contractNo'],
  Case: ['caseNo'],
};
