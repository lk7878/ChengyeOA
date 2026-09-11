import { PermissionCode } from '../authorization/authorization-types';

export const SYSTEM_ADMIN_PERMISSION_CODES = Object.freeze([
  'menu.admin_governance',
  'governance.catalog.read',
  'governance.operation.create',
  'governance.operation.read_self',
  'governance.audit.read',
  'organization.read',
  'position.read',
  'professional_team.read',
  'permission.trace.self',
  'menu.event_operations',
  'event.delivery.read',
] satisfies readonly PermissionCode[]);
