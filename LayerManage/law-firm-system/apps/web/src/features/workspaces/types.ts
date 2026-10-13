export interface Option {
  id: string;
  name: string;
}
export interface Field extends Option {
  type: string;
  required: boolean;
  writable: boolean;
  queryable?: boolean;
  position: number;
  archived: boolean;
  defaultValue: unknown;
  options: {
    choices?: Option[];
    targetTableId?: string;
    helpText?: string;
    businessKey?: string;
    businessSource?: string;
  };
}
export interface Filter {
  join?: 'and' | 'or';
  children?: Filter[];
  fieldId?: string;
  operator?: string;
  value?: unknown;
}
export interface ViewConfig {
  filter?: Filter;
  sorts?: { fieldId: string; direction: 'asc' | 'desc' }[];
  groupBy?: string[];
  visibleFields?: string[];
  widths?: Record<string, number>;
  frozen?: number;
  rowHeight?: number;
  dateFieldId?: string;
  endDateFieldId?: string;
  colorFieldId?: string;
}
export interface View extends Option {
  type: string;
  shared: boolean;
  isDefault: boolean;
  ownerId: string;
  version: number;
  position: number;
  config: ViewConfig;
}
export interface DataTable extends Option {
  canManage?: boolean;
  canDelete?: boolean;
  baseId?: string;
  source: string;
  position: number;
  schemaVersion: number;
  archived: boolean;
}
export interface Base extends Option {
  moduleSource?: string | null;
  version: number;
  workspaceId: string;
}
export interface Workspace extends Option {
  organizationId: string;
  bases: Base[];
}
export interface Access {
  level: number;
  canCreate: boolean;
  canManageAccess?: boolean;
  selfOnly: boolean;
  hidden: string[];
  readonly: string[];
  workspaceId: string;
}
export interface TableDetail {
  canDeleteRecords?: boolean;
  canCreateBusiness?: boolean;
  table: DataTable;
  fields: Field[];
  views: View[];
  access: Access;
  preferredViewId?: string;
  userId: string;
  employeeId: string | null;
}
export interface RecordRow {
  displayValues?: Record<string, string>;
  writable?: boolean;
  id: string;
  tableId: string;
  values: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  ownerId: string;
}
export interface QueryResult {
  records: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
  groupsTruncated?: boolean;
  groups: { keys: unknown[]; count: number }[];
  schemaVersion: number;
}
export interface RecordDetail {
  record: RecordRow;
  revisions: {
    id: string;
    version: number;
    actorId: string;
    createdAt: string;
    changes: Record<string, { before: unknown; after: unknown }>;
  }[];
  comments: { id: string; actorId: string; content: string; createdAt: string }[];
}
export interface Directory {
  organizations: Option[];
  employees: Option[];
  teams: Option[];
  positions?: Option[];
  roles?: Option[];
  users: Option[];
}
export interface Member {
  id: string;
  principalType: string;
  principalId: string;
  role: string;
  canCreate: boolean;
  canManageAccess?: boolean;
  rowScope: string;
  hiddenFields: string[];
  readonlyFields: string[];
  version: number;
}
export const fieldNames: Record<string, string> = {
  TEXT: '文本',
  LONG_TEXT: '多行文本',
  NUMBER: '数字',
  CURRENCY: '金额',
  BOOLEAN: '勾选',
  DATE: '日期',
  DATETIME: '日期时间',
  SINGLE_SELECT: '单选',
  MULTI_SELECT: '多选',
  USER: '人员',
  ORGANIZATION: '组织',
  PHONE: '电话',
  URL: '链接',
  FILE: '附件',
  RELATION: '关联记录',
  CREATED_BY: '创建人',
  CREATED_AT: '创建时间',
  UPDATED_BY: '修改人',
  UPDATED_AT: '修改时间',
};
