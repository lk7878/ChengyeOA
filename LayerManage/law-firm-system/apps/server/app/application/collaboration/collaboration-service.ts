import { syncCustomerSource } from './customer-source-routing';
import { prepareMedicalValues } from './medical-assessment';
import { FIELD_CATALOG } from '../../domain/authorization/field-security-policy';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { applicationPolicies, mayCreateInApplication, initializeTablePolicies } from './application-role-policy';
import { tableBusinessCapabilities, worksheetRuleContext } from './worksheet-business-grants';
import { retiredSources } from '../../domain/module-availability';
import { applyRules, recordFieldLevel, defaultRule, presets, rowPredicate, ruleAllowsWrite, type RolePolicy, type TableRule } from './worksheet-roles';
import { moduleGroup, moduleGroups, ensureModuleWorkspace } from './module-workspaces';
import { inventoryFields, inventoryKinds, InventoryKind, seedInventorySummary, inventorySummarySql, assignInventoryNumber, isInventorySummary, hasInventoryProjection, validateOfficeStock } from './inventory-worksheets';
import { isHrKind, hrPrivate, validateHrRecord } from './hr-worksheets';
import { canManageHr, canReadHrPrivate, hrValues, presentHrValue, hrAge } from './hr-privacy';
import { caseArchiveKinds, isCaseArchiveKind, validateCaseArchiveRecord } from './case-archive-worksheets';
import { isAdministrativeKind, validateAdministrativeRecord } from './administrative-registers';
import { followSupportFields, followSupportKinds, FollowSupportKind } from './follow-support-templates';
import { lawyerProspectFields, lawyerProspectTemplate } from './lawyer-prospect-template';
import { LifecycleWorksheet, lifecycleFields, lifecycleKinds, lifecycleKey, syncedLifecycleKeys, LifecycleKind } from './lifecycle-worksheet';
import { CASE_FIELD_ORDER } from '../case/intake-contract';
import { WorksheetFinance, paymentWorksheetKeys, refundExecutionKeys } from '../finance/worksheet-finance';
import { domainSources, isDomainSource, WorkspaceDomainSource } from '../crm/workspace-domain-source';
import { CaseService } from '../case/case-service';
import { UpdateCaseInput } from '../case/case-types';
import { removeStoredAttachments } from '../case/case-intake';
import { editableCaseKey, caseGridChoices } from './case-grid-fields';
import { editableBusinessFields, editableBusinessKey, isEditableBusinessSource, businessGridChoices } from './business-grid-fields';
import { CustomerService, CreateCustomerInput, UpdateCustomerInput } from '../crm/customer-service';
import { NegotiationService } from '../contract/negotiation-service';
import { ContractService } from '../contract/contract-service';
import { CrmWorksheetService } from '../crm/crm-worksheet-service';
import { editableCrmKey, followTypeChoices } from '../crm/crm-worksheet-fields';
import { UpdateNegotiationInput } from '../contract/contract-types';
import { ChannelService } from '../channel/channel-service';
import { CostService } from '../finance/cost-service';
import { UpdateCostEntryInput } from '../finance/finance-types';
import { InventoryService } from '../inventory/inventory-service';
import { PerformanceService } from '../performance/performance-service';
import { queryCustomRecords } from './custom-record-query';
import { LEAD_SOURCE_TYPES } from '../crm/lead-types';
import { LeadService } from '../crm/lead-service';
import { LeadFollowService, LEAD_FOLLOW_TYPES } from '../crm/lead-follow-service';
import { LeadAssignmentService } from '../crm/lead-assignment-service';
import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { buildLeadScopeWhere } from '../crm/lead-scope';
import { makeBusinessNo } from '../crm/business-no';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuthorizationService } from '../authorization/authorization-service';
import { LEAD_STATUS, canTransition, LeadStatus, REACTIVATE_ENABLED } from '../../domain/crm/lead-policy';
import { businessFields, WorkspaceBusinessTable } from '../crm/workspace-business-table';
import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { CollabField, CollabRecord, CollabTable, CollabMember, Prisma, PrismaClient } from '@prisma/client';
import { appendCollaborationChange } from './collaboration-change';
import { AuthorizationContext } from '../authorization/authorization-service';
import {
  boolean,
  choice,
  exact,
  fail,
  FIELD_TYPES,
  CollaborationError,
  fieldOf,
  filterSql,
  integer,
  isSystemField,
  json,
  object,
  ObjectValue,
  strings,
  text,
  validateOptions,
  validateValue,
  validateView,
  VIEW_TYPES,
  ViewConfig,
} from './collaboration-policy';

import {
  accessInput,
  resourcePolicy,
  resourceLevels as levels,
  restrictResourceAccess,
} from './resource-access';
import { FolderAncestor, folderChainSql, inheritFolders } from './folder-access';

type Tx = Prisma.TransactionClient;
type MemberAccess = Pick<
  CollabMember,
  'role' | 'canCreate' | 'rowScope' | 'canManageAccess' | 'hiddenFields' | 'readonlyFields'
>;
export interface Access {
  createOnly?:boolean;
  import?:boolean;
  previewCeiling?: Access;
  rules?: TableRule[];
  viewIds?: string[];
  rowIds?: string[];
  scopedRules?: {rule:TableRule;ids?:Set<string>}[];
  conditional?: string[];
  masked?: string[];
  add?: boolean;
  remove?: boolean;
  copy?: boolean;
  analytics?: boolean;
  automate?: boolean;
  level: number;
  canCreate: boolean;
  canManageAccess: boolean;
  selfOnly: boolean;
  hidden: string[];
  readonly: string[];
  workspaceId: string;
  organizationId: string;
}

function publicAccess(access: Access) {
  const visible = { ...access };
  delete visible.rules;
  delete visible.rowIds;
  delete visible.scopedRules;
  delete visible.conditional;
  delete visible.previewCeiling;
  return visible;
}

export class CollaborationService {
  constructor(
    readonly db: PrismaClient,
    readonly actor: AuthorizationContext,
    readonly preview?: { roleId: string } | { tableId: string; preset: TableRule['level']; viewer: AuthorizationContext },
  ) {}
  protected async principals(tx: Tx): Promise<Array<{ principalType: string; principalId: string }>> {
    const previewRole = this.preview && 'roleId' in this.preview ? this.preview.roleId : this.actor.previewRoleId;
    if (previewRole) return [{principalType: 'ROLE', principalId: previewRole}];
    const result = [{ principalType: 'USER', principalId: this.actor.userId }];
    const now = new Date();
    const activeRoles = await tx.userRole.findMany({
      where: {
        userId: this.actor.userId,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { status: 'ENABLED' },
        user: { status: 'ENABLED' },
      },
      select: { roleId: true },
    });
    result.push(...activeRoles.map((r) => ({ principalType: 'ROLE', principalId: r.roleId })));
    if (!this.actor.employeeId) return result;
    const employee = await tx.employee.findFirst({
      where: { id: this.actor.employeeId, deletedAt: null, status: { not: 'LEAVED' } },
    });
    if (!employee) return [];
    const [assignments, teams] = await Promise.all([
      tx.employeeAssignment.findMany({
        where: {
          employeeId: this.actor.employeeId,
          startedAt: { lte: now },
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        include: { organization: true, position: true },
      }),
      tx.professionalTeamMember.findMany({
        where: { employeeId: this.actor.employeeId, endedAt: null, professionalTeam: { status: 'ENABLED' } },
      }),
    ]);
    for (const assignment of assignments) {
      if (assignment.organization.status !== 'ENABLED') continue;
      if (assignment.position.status === 'ENABLED' && !assignment.position.deletedAt)
        result.push({ principalType: 'POSITION', principalId: assignment.positionId });
      const ancestors = await tx.organization.findMany({
        where: {
          status: 'ENABLED',
          OR: [
            { id: assignment.organizationId },
            { id: { in: assignment.organization.path.split('/').filter(Boolean) } },
          ],
        },
        select: { id: true },
      });
      result.push(...ancestors.map((o) => ({ principalType: 'ORG', principalId: o.id })));
      result.push({ principalType: 'ORG', principalId: assignment.organizationId });
    }
    result.push(...teams.map((t) => ({ principalType: 'TEAM', principalId: t.professionalTeamId })));
    return result;
  }
  async access(workspaceId: string, tx: Tx = this.db, level = 1): Promise<Access> {
    const w = await tx.collabWorkspace.findUnique({ where: { id: workspaceId } });
    if (!w) fail('COLLAB_NOT_FOUND', 404);
    this.authorizeModuleGroup(w.moduleGroup);
    const members = await tx.collabMember.findMany({ where: { workspaceId, OR: await this.principals(tx) } });
    if(!members.length && await mayCreateInApplication(tx,this.actor,workspaceId)) {
      if(level>1) fail('COLLAB_FORBIDDEN',403);
      return {level:1,canCreate:true,createOnly:true,selfOnly:false,canManageAccess:false,hidden:[],readonly:[],workspaceId,organizationId:w.organizationId};
    }
    const access=this.memberAccess(workspaceId, w.organizationId, members, level);
    if(await mayCreateInApplication(tx,this.actor,workspaceId)) access.canCreate=true;
    return access;
  }
  private memberAccess(
    workspaceId: string,
    organizationId: string,
    members: MemberAccess[],
    level = 1,
  ): Access {
    // A resource owner is explicit, never inferred from a system administrator flag.
    const effective = Math.max(0, ...members.map((m) => levels[m.role] ?? 0));
    if (effective < level) fail('COLLAB_FORBIDDEN', 403);
    return {
      level: effective,
      canCreate: effective >= 3 || (effective >= 2 && members.some((m) => m.canCreate)),
      selfOnly: effective === 4 ? false : members.every((m) => m.rowScope === 'SELF'),
      canManageAccess:
        effective === 4 ||
        (effective >= 3 &&
          members.some((m) => m.canManageAccess && m.rowScope === 'ALL') &&
          members.every((m) => !m.hiddenFields.length && !m.readonlyFields.length)),
      hidden: [...new Set(members.flatMap((m) => m.hiddenFields))],
      readonly: [...new Set(members.flatMap((m) => m.readonlyFields))],
      workspaceId,
      organizationId,
    };
  }
  private async restrict(
    parent: Access,
    raw: unknown,
    tx: Tx,
    currentPrincipals?: Awaited<ReturnType<CollaborationService['principals']>>,
  ): Promise<Access> {
    if (parent.level === 4) return parent;
    return restrictResourceAccess(parent, raw, currentPrincipals ?? (await this.principals(tx)));
  }
  private async directTables(tx: Tx, baseId?: string) {
    const principals = await this.principals(tx);
    const roles = principals.filter(p=>p.principalType==='ROLE').map(p=>p.principalId);
    return tx.$queryRaw<Array<{id:string; workspaceId:string; baseId:string}>>(Prisma.sql`
      SELECT t.id, b.id AS "baseId", b."workspaceId" FROM worksheet_role_policy rp
      JOIN collab_table t ON t.id=rp."tableId" JOIN collab_base b ON b.id=t."baseId"
      WHERE NOT t.archived AND ${baseId ? Prisma.sql`b.id=${baseId}` : Prisma.sql`TRUE`}
      AND (jsonb_exists(rp.invitations,${this.actor.userId}) OR jsonb_exists_any(rp.rules,${roles}::text[]))`);
  }
  async baseAccess(baseId: string, tx: Tx = this.db, level = 1) {
    const stored = await tx.collabBase.findUnique({
      where: { id: baseId },
      include: { driveNode: { select: { deletedAt: true } } },
    });
    if (!stored) fail('COLLAB_NOT_FOUND', 404);
    const { driveNode, ...base } = stored;
    if (driveNode?.deletedAt) fail('COLLAB_FORBIDDEN', 403);
    let parent: Access;
    try { parent = await this.access(base.workspaceId, tx); }
    catch (err) {
      if ((err as {code:string}).code !== 'COLLAB_FORBIDDEN' || level > 1) throw err;
      const direct = await this.directTables(tx,baseId);
      let matched: Access | undefined;
      for (const t of direct) {
        try { matched=(await this.tableAccess(t.id,tx)).access; break; }
        catch (e) { if (!['COLLAB_FORBIDDEN','COLLAB_NOT_FOUND'].includes((e as {code:string}).code)) throw e; }
      }
      if (!matched) throw err;
      parent={level:1,canCreate:false,canManageAccess:false,selfOnly:false,hidden:[],readonly:[],workspaceId:base.workspaceId,organizationId:matched.organizationId};
    }
    const workspace = await tx.collabWorkspace.findUniqueOrThrow({where:{id:base.workspaceId}});
    if (workspace.moduleGroup && base.moduleSource) this.moduleSource(base.moduleSource);
    const principals = await this.principals(tx);
    const [path] = await tx.$queryRaw<Array<{ chain: FolderAncestor[] }>>(
      Prisma.sql`SELECT ${folderChainSql(Prisma.sql`${baseId}`)} AS chain`,
    );
    let access: Access;
    try {
      access = restrictResourceAccess(inheritFolders(parent, path.chain, principals),base.accessPolicy,principals);
    } catch (error) {
      if (level !== 1 || (error as {code:string}).code !== 'COLLAB_FORBIDDEN') throw error;
      access = {...parent,level:0,canCreate:false,canManageAccess:false};
    }
    // A direct worksheet grant also permits navigating to its directory. It
    // does not grant access to sibling tables or directory administration.
    if (access.level < 1 && level === 1) {
      for (const candidate of await this.directTables(tx, baseId)) {
        try {
          const child = await this.tableAccess(candidate.id, tx);
          access = {level:1,canCreate:false,canManageAccess:false,selfOnly:false,
            hidden:[],readonly:[],workspaceId:base.workspaceId,organizationId:child.access.organizationId};
          break;
        } catch (error) {
          if (!['COLLAB_FORBIDDEN','COLLAB_NOT_FOUND'].includes((error as {code:string}).code)) throw error;
        }
      }
    }
    if (base.moduleSource==='INVENTORY_STOCKTAKES' && !canManageHr(this.actor)) { access.canCreate=false; access.level=Math.min(access.level,1); }
    if (access.level < level) fail('COLLAB_FORBIDDEN', 403);
    return { base, access };
  }
  async tableAccess(tableId: string, tx: Tx = this.db, level = 1, allowArchived = false, withFields = true) {
    const principals = await this.principals(tx);
    const principalWhere = principals.length
      ? Prisma.join(
          principals.map(
            (p) =>
              Prisma.sql`(m."principalType" = ${p.principalType} AND m."principalId" = ${p.principalId})`,
          ),
          ' OR ',
        )
      : Prisma.sql`FALSE`;
    const rows = await tx.$queryRaw<
      Array<
        CollabTable & {
          _rolePolicy: RolePolicy | null;
          _moduleGroup: string | null;
          _moduleSource: string | null;
          _workspaceId: string;
          _organizationId: string;
          _basePolicy: Prisma.JsonValue;
          _members: MemberAccess[];
          _fields: CollabField[];
          _folderChain: FolderAncestor[];
          _driveDeletedAt: Date | null;
        }
      >
    >(Prisma.sql`
      SELECT t.*, (SELECT jsonb_build_object('rules',rp.rules,'invitations',rp.invitations)
        FROM worksheet_role_policy rp WHERE rp."tableId"=t.id) AS "_rolePolicy", w."moduleGroup" AS "_moduleGroup", b."moduleSource" AS "_moduleSource", b."workspaceId" AS "_workspaceId", b."accessPolicy" AS "_basePolicy", w."organizationId" AS "_organizationId",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'role', m.role, 'canCreate', m."canCreate", 'rowScope', m."rowScope", 'canManageAccess', m."canManageAccess",
          'hiddenFields', m."hiddenFields", 'readonlyFields', m."readonlyFields")), '[]'::jsonb)
         FROM collab_member m WHERE m."workspaceId" = w.id AND (${principalWhere})) AS "_members",
        (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.position), '[]'::jsonb) FROM collab_field f WHERE f."tableId" = t.id AND (${withFields} OR EXISTS (SELECT 1 FROM worksheet_role_policy rp WHERE rp."tableId"=t.id))) AS "_fields",
        ${folderChainSql(Prisma.sql`b.id`)} AS "_folderChain", dn."deletedAt" AS "_driveDeletedAt"
      FROM collab_table t JOIN collab_base b ON b.id = COALESCE(t."originBaseId",t."baseId")
      LEFT JOIN drive_node dn ON dn.id = b.id
      JOIN collab_workspace w ON w.id = b."workspaceId" WHERE t.id = ${tableId}
    `);
    const row = rows[0];
    if (!row || (row.archived && !allowArchived)) fail('COLLAB_NOT_FOUND', 404);
    if (row._driveDeletedAt) fail('COLLAB_FORBIDDEN', 403);
    this.authorizeModuleGroup(row._moduleGroup);
    if (row.inventoryKind) new WorkspaceBusinessTable(this.db, this.actor).authorize(isCaseArchiveKind(row.inventoryKind) ? 'CASES' : isHrKind(row.inventoryKind) ? 'INVENTORY_STOCKTAKES' : 'INVENTORY_ITEMS');
    if (isCaseArchiveKind(row.inventoryKind) && (row._moduleGroup !== 'CASES' || row._moduleSource !== 'CASES')) fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
    if (isHrKind(row.inventoryKind) && level >= 2 && !canManageHr(this.actor)) fail('COLLAB_FORBIDDEN',403);
    if (row._moduleGroup && row._moduleSource && row.source === 'CUSTOM') this.moduleSource(row._moduleSource);
    // Record mutations request level 2; directory administration requests level 3.
    if (isInventorySummary(row.inventoryKind) && level === 2) fail('COLLAB_READONLY_FIELD', 403);
    const {
      _rolePolicy,
      _moduleGroup: _ignoredGroup,
      _moduleSource: _ignoredSource,
      _workspaceId,
      _organizationId,
      _basePolicy,
      _members,
      _fields,
      _folderChain,
      _driveDeletedAt: _ignoredDeletion,
      ...definition
    } = row;
    void _ignoredDeletion; void _ignoredGroup; void _ignoredSource;
    const preset = this.preview && 'preset' in this.preview && this.preview.tableId === tableId ? this.preview : undefined;
    let access: Access;
    if (preset) {
      // A preset has no account or ancestor memberships. Bound the simulation by the
      // viewer's real access to this table, then project the selected worksheet role.
      if (!preset.viewer.isSystemSuperAdmin || level !== 1) fail('COLLAB_FORBIDDEN',403);
      const viewer = new CollaborationService(this.db,preset.viewer);
      let ceiling: Access;
      try {
        ceiling = (await viewer.tableAccess(tableId,tx)).access;
      } catch (error) {
        if ((error as {status?:number}).status === 403) fail('WORKSHEET_PREVIEW_VIEWER_DENIED',403);
        throw error;
      }
      access = {...ceiling, hidden:[...ceiling.hidden], readonly:[...ceiling.readonly],
        rules:undefined, scopedRules:undefined, rowIds:undefined, conditional:undefined, viewIds:undefined, previewCeiling:ceiling};
      applyRules(access, [_rolePolicy?.rules[preset.preset] ?? defaultRule(preset.preset)], _fields);
      access.masked = [...new Set([...(ceiling.masked ?? []), ...(access.masked ?? [])])];
      access.conditional = ceiling.conditional;
      if (ceiling.viewIds) access.viewIds = ceiling.viewIds.filter(id=>!access.viewIds || access.viewIds.includes(id));
      for (const flag of ['add','remove','analytics','copy','automate'] as const)
        if (ceiling[flag] === false) access[flag] = false;
    } else {
      let invitedRole = _rolePolicy?.invitations[this.actor.userId];
      if (invitedRole && !presets.some(p=>p===invitedRole) &&
        !await tx.role.findFirst({where:{id:invitedRole,status:'ENABLED',type:'BUSINESS'},select:{id:true}})) invitedRole=undefined;
      const roleIds = principals.filter(p => p.principalType === 'ROLE').map(p => p.principalId);
      const assigned = roleIds.filter(id => _rolePolicy?.rules[id]);
      const direct = invitedRole || assigned.length > 0;
      const explicitTableGrant = !!(invitedRole && _rolePolicy?.rules[invitedRole]?.business) || assigned.some(id=>_rolePolicy?.rules[id]?.business && _rolePolicy.rules[id].level!=='DENY');
      const joined = _members.length > 0;
      const workspaceAccess = joined || direct ? this.memberAccess(_workspaceId, _organizationId, joined ? _members :
        [{role:'READER', rowScope:'ALL', canCreate:false, canManageAccess:false, hiddenFields:[], readonlyFields:[]}])
        : await this.access(_workspaceId,tx);
      const parent = explicitTableGrant ? {...workspaceAccess,level:3} : await this.restrict(inheritFolders(workspaceAccess, _folderChain, principals), _basePolicy, tx, principals);
      if (!definition.accessPolicy && !_basePolicy && _folderChain.every(f => !f.accessPolicy) &&
        definition.createdBy === this.actor.userId && parent.level >= 2 && parent.canCreate)
        parent.level = Math.max(parent.level, 3);
      access = direct ? {...parent} : await this.restrict(parent, definition.accessPolicy, tx, principals);
      const owner = joined && workspaceAccess.level === 4;
      if (!owner) {
        const inherited = ['DENY','READER','EDITOR','MANAGER','OWNER'][access.level];
        const preset = invitedRole || (joined ? inherited : undefined);
        const rules = assigned.map(id => _rolePolicy!.rules[id]);
        const presetConfig = preset && _rolePolicy?.rules[preset];
        if (presetConfig) rules.push(presetConfig);
        else if (invitedRole && presets.some(p => p === preset))
          rules.push(defaultRule(preset as TableRule['level']));
        if (direct && !_basePolicy && _folderChain.every(f => !f.accessPolicy))
          access.level = 3;
        applyRules(access, rules, _fields);
        if (direct && access.level>=3 && !access.selfOnly && !access.hidden.length && !access.readonly.length &&
            rules.some(r=>r.share!==false && r.rows==='ALL' && (r.level==='MANAGER'||r.level==='OWNER'))) access.canManageAccess=true;
      }
    }
    if(definition.originBaseId && definition.originBaseId!==definition.baseId){
      const destination=await tx.collabBase.findUniqueOrThrow({where:{id:definition.baseId},include:{driveNode:{select:{deletedAt:true}}}});
      if(destination.driveNode?.deletedAt)fail('COLLAB_FORBIDDEN',403);
      const root=await this.access(destination.workspaceId,tx);
      const [location]=await tx.$queryRaw<Array<{chain:FolderAncestor[]}>>(Prisma.sql`SELECT ${folderChainSql(Prisma.sql`${destination.id}`)} AS chain`);
      const ceiling=await this.restrict(inheritFolders(root,location.chain,principals),destination.accessPolicy,tx,principals);
      access={...access,level:Math.min(access.level,ceiling.level),canCreate:access.canCreate&&ceiling.canCreate,
        canManageAccess:access.canManageAccess&&ceiling.canManageAccess,selfOnly:access.selfOnly||ceiling.selfOnly,
        hidden:[...new Set([...access.hidden,...ceiling.hidden])],readonly:[...new Set([...access.readonly,...ceiling.readonly])]};
    }
    if (retiredSources.includes(definition.source)) {
      if (level > 1) fail('MODULE_RETIRED',409);
      access.level = Math.min(access.level,1); access.add=false; access.remove=false; access.automate=false; access.canManageAccess=false;
      access.readonly = [...new Set([...access.readonly,..._fields.map(f=>f.id)])];
    }
    if (access.level < level) fail('COLLAB_FORBIDDEN', 403);
    const table = {
      ...definition,
      fields: _fields,
    };
    if (isInventorySummary(table.inventoryKind)) {
      access.canCreate = false;
      access.readonly = [...new Set([...access.readonly, ...table.fields.map(f => f.id)])];
    }
    if (isHrKind(table.inventoryKind)) {
      if (!canManageHr(this.actor)) { access.canCreate=false; access.readonly=[...new Set([...access.readonly,...table.fields.map(f=>f.id)])]; }
      if (!canReadHrPrivate(this.actor)) access.readonly=[...new Set([...access.readonly,...table.fields.filter(hrPrivate).map(f=>f.id)])];
    }
    const visible = table.fields.filter(f => !f.archived && !access.hidden.includes(f.id));
    if (table.inventoryKind === 'ADMIN_SEAL' && !this.actor.isSystemSuperAdmin && !this.actor.permissionCodes.includes('inventory.seal.review'))
      access.readonly.push(...visible.filter(f => object(f.options).adminReview).map(f => f.id));
    const fields = table.source === 'CUSTOM' ? visible : new WorkspaceBusinessTable(this.db, this.actor).visibleFields(table.source, visible);
    if (access.rules?.every(r => r.rows !== 'ALL' || !!r.business)) {
      const rawFields = table.fields.filter(f => !f.archived);
      access.rowIds = await this.matchingRows(table, access, rawFields, access.rules, tx);
    }
    const allowedIds=access.previewCeiling?.rowIds;
    if (allowedIds) {
      const allowed=new Set(allowedIds);
      access.rowIds=access.rowIds ? access.rowIds.filter(id=>allowed.has(id)) : allowedIds;
    }
    if (access.rules && access.rules.length > 1 && access.rules.some(r=>r.rows!=='ALL'||!!r.business)) {
      access.conditional=fields.filter(f=>new Set(access.rules.map(r=>r.fields[f.id] ?? 'EDIT')).size>1).map(f=>f.id);
      if (access.conditional.length || new Set(access.rules.map(r=>r.level)).size>1) {
        access.scopedRules=[];
        for (const rule of access.rules) {
          const ids=rule.rows==='ALL' && !rule.business ? undefined : new Set(await this.matchingRows(table,access,table.fields,[rule],tx));
          access.scopedRules.push({rule,ids});
        }
      }
    }
    return { table, access, fields: fields.map(f => access.masked?.includes(f.id) || access.conditional?.includes(f.id)
      ? { ...f, defaultValue:null, options:{...object(f.options), worksheetMasked:!!access.masked?.includes(f.id),
        conditionalField:!!access.conditional?.includes(f.id)} as Prisma.JsonObject } : f) };
  }
  async checkCaseCreation(tableId:string,id:string,keys:string[],tx:Tx,raw:unknown = {}) {
    const {table,access,fields}=await this.tableAccess(tableId,tx,2);
    if (table.source!=='CASES' || access.add===false) fail('COLLAB_FORBIDDEN',403);
    const changed=keys.map(key=>{
      const f=fields.find(field=>object(field.options).businessKey===key);
      if (!f || access.readonly.includes(f.id)) fail('COLLAB_FIELD_UNAVAILABLE',403);
      return f.id;
    });
    const extensions=fields.filter(f=>!object(f.options).businessKey);
    const patch=object(raw);
    const values=await this.values(tx,tableId,extensions,access,patch,{},true);
    if (Object.keys(values).length) {
      const changes=Object.fromEntries(Object.entries(values).map(([field,after])=>[field,{before:null as null,after}]));
      await tx.collabExtension.create({data:{tableId,recordId:id,updatedBy:this.actor.userId,values:json(values),
        revisions:{create:{version:1,actorId:this.actor.userId,changes:json(changes)}}}});
    }
    const source=new WorkspaceDomainSource(this.db,this.actor);
    await source.target('CASES',access,id,tx,'read');
    const required=table.fields.filter(f=>!f.archived && f.required && !isSystemField(f));
    if(required.length) {
      const sql=await source.sourceSql(table,access,required);
      const [row]=await tx.$queryRaw<{values:ObjectValue}[]>(Prisma.sql`SELECT r.values FROM (${sql}) r WHERE r.id=${id}`);
      for(const f of required){
        const value=row?.values[f.id];
        if(value==null || value==='' || (Array.isArray(value) && !value.length)) fail('COLLAB_REQUIRED_FIELD',422,{fieldId:f.id});
      }
    }
    await this.checkRowWrite(table,access,tx,id,[...changed,...Object.keys(patch)],'add');
    await this.event(tx,table.baseId,'record.updated',id);
  }
  private async matchingRows(table: CollabTable, access: Access, fields: CollabField[], rules: TableRule[], tx: Tx, id?: string):Promise<string[]> {
    if(rules.length>1 && rules.some(rule=>!!rule.business)) {
      const matches=await Promise.all(rules.map(rule=>this.matchingRows(table,access,fields,[rule],tx,id)));
      return [...new Set(matches.flat())];
    }
    const actor=rules.length===1?worksheetRuleContext(this.actor,rules[0]):this.actor;
    const source = table.source !== 'CUSTOM' ? await new WorkspaceBusinessTable(this.db, actor).sourceSql(table, access, fields)
      : table.lifecycleKind ? await this.lifecycle().sourceSql(table,access,fields)
      : hasInventoryProjection(table.inventoryKind) ? await inventorySummarySql(this.db,table,fields,this.actor.userId,key => this.tableAccess(key,tx))
      : Prisma.sql`SELECT * FROM collab_record WHERE "tableId"=${table.id}`;
    const rows = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT r.id FROM (${source}) r WHERE NOT r.archived
      AND ${id ? Prisma.sql`r.id=${id}` : Prisma.sql`TRUE`}
      AND ${rowPredicate(rules, fields, this.actor.userId, this.actor.employeeId)}`);
    return rows.map(row => row.id);
  }
  private async checkRowWrite(table: CollabTable & {fields:CollabField[]}, access: Access, tx: Tx, id: string,
    fieldIds: string[], action: 'edit'|'add'|'remove') {
    if (!access.rules) return;
    const groups = fieldIds.length ? fieldIds.map(key => [key]) : [[]];
    for (const group of groups) {
      const rules = access.rules.filter(r => ruleAllowsWrite(r,group,action));
      if (!rules.length || (!rules.some(r => r.rows === 'ALL' && !r.business) &&
        !(await this.matchingRows(table,access,table.fields,rules,tx,id)).length)) fail('COLLAB_FORBIDDEN',403);
    }
  }
  protected async assertActiveNode(nodeId: string, tx: Tx = this.db) {
    const [node] = await tx.$queryRaw<Array<{ deletedAt: Date | null; chain: FolderAncestor[] }>>(Prisma.sql`
      SELECT n."deletedAt", ${folderChainSql(Prisma.sql`${nodeId}`)} AS chain FROM drive_node n WHERE n.id = ${nodeId}
    `);
    if (node && (node.deletedAt || node.chain.some((folder) => folder.deletedAt)))
      fail('COLLAB_FORBIDDEN', 403);
  }
  protected async requireAccessAdmin(workspaceId: string, tx: Tx = this.db) {
    const access = await this.access(workspaceId, tx);
    if (!access.canManageAccess) fail('COLLAB_FORBIDDEN', 403);
    return access;
  }
  protected async resourceMembers(workspaceId: string, creators: string[], tx: Tx = this.db) {
    const members = await tx.collabMember.findMany({ where: { workspaceId } });
    for (const principalId of new Set(creators)) {
      if (!members.some((m) => m.principalType === 'USER' && m.principalId === principalId)) {
        // A selector for an existing resource creator, never a new workspace grant.
        members.push({
          id: 'resource-creator:' + principalId,
          workspaceId,
          principalId,
          principalType: 'USER',
          role: 'MANAGER',
          rowScope: 'SELF',
          canCreate: true,
          canManageAccess: false,
          hiddenFields: [],
          readonlyFields: [],
          version: 1,
        });
      }
    }
    return members;
  }
  private async resource(kind: 'BASE' | 'TABLE', id: string, tx: Tx) {
    const table = kind === 'TABLE' ? await tx.collabTable.findUnique({ where: { id } }) : null;
    const base = await tx.collabBase.findUnique({
      where: { id: kind === 'BASE' ? id : (table?.baseId ?? '') },
    });
    if (!base || (kind === 'TABLE' && !table)) fail('COLLAB_NOT_FOUND', 404);
    await this.requireAccessAdmin(base.workspaceId, tx);
    await this.assertActiveNode(base.id, tx);
    const node = await tx.driveNode.findUnique({ where: { baseId: base.id }, select: { ownerId: true } });
    return {
      target: table ?? base,
      base,
      creators: [...(node ? [node.ownerId] : []), ...(table ? [table.createdBy] : [])],
    };
  }
  async resourceAccess(kind: 'BASE' | 'TABLE', id: string) {
    const { target, base, creators } = await this.resource(kind, id, this.db);
    const [path] =
      kind === 'BASE'
        ? await this.db.$queryRaw<Array<{ folders: FolderAncestor[] }>>(Prisma.sql`
      SELECT ${folderChainSql(Prisma.sql`${base.id}`)} AS folders
    `)
        : [];
    return {
      folders: path?.folders.map((folder) => ({ id: folder.id, name: folder.folderName })) ?? [],
      version: target.accessVersion,
      policy: resourcePolicy(target.accessPolicy),
      members: await this.resourceMembers(base.workspaceId, creators),
    };
  }
  async saveResourceAccess(kind: 'BASE' | 'TABLE', id: string, raw: unknown, key: unknown) {
    const input = accessInput(raw);
    const initial = await this.resource(kind, id, this.db);
    return this.write(key, ['resource.access', kind, id, input], async (tx) => {
      await this.lock(tx, initial.base.workspaceId);
      const { target, base, creators } = await this.resource(kind, id, tx);
      if (target.accessVersion !== input.version) fail('COLLAB_ACCESS_CONFLICT', 409);
      const members = await this.resourceMembers(base.workspaceId, creators, tx);
      for (const grant of input.policy.grants) {
        if (
          !members.some(
            (m) =>
              m.principalType === grant.principalType &&
              m.principalId === grant.principalId &&
              m.role !== 'OWNER',
          )
        )
          fail('COLLAB_MEMBER_UNAVAILABLE');
        const ids = [...new Set([...grant.hiddenFields, ...grant.readonlyFields])];
        const count = await tx.collabField.count({
          where: { id: { in: ids }, ...(kind === 'TABLE' ? { tableId: id } : { table: { baseId: id } }) },
        });
        if (count !== ids.length) fail('COLLAB_INVALID_ACCESS');
      }
      const data = {
        accessPolicy:
          !input.policy.restricted && input.policy.grants.length === 0 ? Prisma.DbNull : json(input.policy),
        accessVersion: { increment: 1 },
      };
      if (kind === 'BASE') await tx.collabBase.update({ where: { id }, data });
      else await tx.collabTable.update({ where: { id }, data });
      await this.event(tx, base.id, 'access.updated', id);
      return { id, version: target.accessVersion + 1 };
    });
  }
  protected async lock(tx: Tx, workspaceId: string, shared = false) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM collab_workspace WHERE id = ${workspaceId} ${shared ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`}`,
    );
  }
  protected async write<T>(
    key: unknown,
    payload: unknown,
    callback: (tx: Tx) => Promise<T>,
    transaction?: Tx,
  ): Promise<T> {
    if (transaction) return callback(transaction);
    const mutationKey = text(key, 120);
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ':' + mutationKey}, 0))`,
          );
          const existing = await tx.collabMutation.findUnique({
            where: { actorId_key: { actorId: this.actor.userId, key: mutationKey } },
          });
          if (existing) {
            if (existing.fingerprint !== fingerprint) fail('COLLAB_IDEMPOTENCY_CONFLICT', 409);
            return existing.result as T;
          }
          const result = await callback(tx);
          await tx.collabMutation.create({
            data: { actorId: this.actor.userId, key: mutationKey, fingerprint, result: json(result) },
          });
          return result;
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        fail('COLLAB_NAME_OR_ID_CONFLICT', 409);
      throw error;
    }
  }
  protected async event(tx: Tx, baseId: string, kind: string, targetId: string) {
    await appendCollaborationChange(tx, this.actor.userId, baseId, kind, targetId);
  }

  protected authorizeModuleGroup(group: string | null) {
    if (!group) return;
    if (!moduleGroups[group]?.sources.some(source => {
      try { new WorkspaceBusinessTable(this.db, this.actor).authorize(source); return true; } catch { return false; }
    })) fail('COLLAB_FORBIDDEN', 403);
  }
  protected async assertModuleWorkspace(workspaceId: string, source: string | null, tx: Tx = this.db) {
    const workspace = await tx.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (source === 'INVENTORY_STOCKTAKES' && workspace.moduleGroup !== 'HUMAN_RESOURCES') fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
    if (source === 'INVENTORY_MOVEMENTS' && workspace.moduleGroup !== 'ADMINISTRATION')
      fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
    if (workspace.moduleGroup && source && moduleGroup(source) !== workspace.moduleGroup)
      fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
  }
  async provisionModuleWorkspace(parentId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['source']);
    const source = this.moduleSource(input.source);
    if (!source) fail('COLLAB_INVALID_SOURCE');
    await this.access(parentId, this.db, 3);
    return this.write(key, ['workspace.module', parentId, source], async tx => {
      await this.access(parentId, tx, 3);
      const workspace = await ensureModuleWorkspace(tx, parentId, moduleGroup(source), this.actor.userId);
      return { id: workspace.id };
    });
  }
  async listWorkspaces(raw: unknown = {}) {
    const input = exact(raw, ['source']);
    const source = this.moduleSource(input.source);
    const group = source ? moduleGroup(source) : null;
    const members = await this.db.collabMember.findMany({
      where: { OR: await this.principals(this.db) },
      select: { workspaceId: true },
    });
    const direct = await this.directTables(this.db);
    const applicationGrants=await applicationPolicies(this.db,this.actor);
    const workspaces = await this.db.collabWorkspace.findMany({
      where: { id: { in: [...members,...direct,...applicationGrants.filter(p=>p.canCreate)].map(m=>m.workspaceId) } },
      include: { bases: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const available: typeof workspaces = [];
    const provisionParents: { id: string; name: string }[] = [];
    for (const workspace of workspaces) {
      try {
        const access = await this.access(workspace.id);
        if (group && !workspace.moduleGroup && access.level >= 3) provisionParents.push({ id: workspace.id, name: workspace.name });
        if (group && (workspace.moduleGroup !== group || (access.level < 3 && !access.canCreate))) continue;
      } catch (e) { if ((e as {code:string}).code !== 'COLLAB_FORBIDDEN') throw e;
        if (group || !direct.some(t=>t.workspaceId===workspace.id)) continue; }
      available.push(workspace);
      const permitted = [] as typeof workspace.bases;
      for (const base of workspace.bases) {
        try {
          await this.baseAccess(base.id);
          permitted.push({ ...base, accessPolicy: null as null });
        } catch (error) {
          if ((error as { code?: string }).code !== 'COLLAB_FORBIDDEN') throw error;
        }
      }
      workspace.bases = permitted;
      if (!permitted.length && !members.some(m=>m.workspaceId===workspace.id) && !applicationGrants.some(p=>p.workspaceId===workspace.id&&p.canCreate)) available.pop();
    }
    return {
      workspaces: available,
      provisionParents,
      canCreate:
        this.actor.isSystemSuperAdmin ||
        this.actor.permissionCodes.some((p) => String(p) === 'workspace.create'),
    };
  }
  async businessTables(raw: unknown = {}) {
    const input = exact(raw, ['source', 'recordId', 'inventoryKind']);
    const source = choice(input.source ?? 'LEADS', ['LEADS', 'FOLLOWS', ...Object.keys(domainSources)]);
    const inventoryKind = input.inventoryKind === undefined ? undefined : choice(input.inventoryKind, inventoryKinds);
    if (inventoryKind && source !== (isCaseArchiveKind(inventoryKind) ? 'CASES' : isHrKind(inventoryKind) ? 'INVENTORY_STOCKTAKES' : isAdministrativeKind(inventoryKind) ? 'INVENTORY_MOVEMENTS' : 'INVENTORY_ITEMS')) fail('COLLAB_INVALID_SOURCE');
    const recordId = input.recordId === undefined ? undefined : text(input.recordId);
    if (recordId && source === 'FOLLOWS') fail('COLLAB_INVALID_SOURCE');
    new WorkspaceBusinessTable(this.db, this.actor).authorize(source);
    const tables: {
      id: string;
      name: string;
      source: string;
      baseId: string;
      lifecycleKind: string | null;
      inventoryKind: string | null;
      baseName: string;
      moduleSource: string | null;
      workspaceName: string;
    }[] = [];
    const targets: { id: string; name: string; workspaceName: string }[] = [];
    const { workspaces } = await this.listWorkspaces();
    for (const workspace of workspaces)
      for (const base of workspace.bases) {
        try {
          const directory = await this.listTables(base.id);
          if (!recordId && (!workspace.moduleGroup || workspace.moduleGroup === moduleGroup(source)) && directory.access.level === 4 && directory.access.canCreate && targets.length < 200)
            targets.push({ id: base.id, name: base.name, workspaceName: workspace.name });
          for (const table of directory.tables) {
            if (inventoryKind && table.inventoryKind !== inventoryKind) continue;
            const associatedCustomTable =
              (table.source === 'CUSTOM'||!!table.originBaseId) && directory.base.moduleSource === source && !recordId;
            const originalSource=table.source===source && (recordId||!table.originBaseId||directory.base.moduleSource===source);
            if ((!originalSource && !associatedCustomTable) || table.archived || tables.length >= 200)
              continue;
            if (recordId) {
              try {
                if (isDomainSource(source)) {
                  const selected = await this.tableAccess(table.id);
                  await new WorkspaceDomainSource(this.db, this.actor).target(
                    source,
                    selected.access,
                    recordId,
                    this.db,
                    'read',
                  );
                } else await this.businessLead(table.id, recordId);
              } catch (e) {
                if (['COLLAB_NOT_FOUND', 'COLLAB_FORBIDDEN'].includes((e as { code?: string }).code ?? ''))
                  continue;
                throw e;
              }
            }
            tables.push({
              id: table.id,
              name: table.name,
              source: table.source,
              lifecycleKind: table.lifecycleKind,
              inventoryKind: table.inventoryKind,
              baseId: base.id,
              baseName: base.name,
              moduleSource: directory.base.moduleSource,
              workspaceName: workspace.name,
            });
          }
        } catch (e) {
          if (!['COLLAB_NOT_FOUND', 'COLLAB_FORBIDDEN'].includes((e as { code?: string }).code ?? ''))
            throw e;
        }
      }
    return { tables, targets };
  }
  private async canCreateBusiness(
    table: CollabTable,
    access: Access,
    fields: CollabField[],
    tx: Tx = this.db,
  ) {
    if (access.add === false) return false;
    if (table.source === 'FOLLOWS')
      return access.level >= 2 && this.actor.permissionCodes.includes('lead.read') &&
        this.actor.permissionCodes.includes('lead.update') && ['leadId', 'type', 'content'].every(key =>
          fields.some(f => object(f.options).businessKey === key && !access.readonly.includes(f.id)));
    if (table.source !== 'LEADS' || access.level < 2 || !this.actor.permissionCodes.includes('lead.create'))
      return false;
    if (
      ['name', 'phone'].some(
        (key) =>
          !fields.some((f) => object(f.options).businessKey === key && !access.readonly.includes(f.id)),
      )
    )
      return false;
    const authorization = new AuthorizationService(new DataScopeService(this.db));
    const reads = await authorization.resolveScopeTargets(this.actor, 'lead', 'lead.read');
    if (
      !reads.all &&
      !(
        reads.organizationTargets.length &&
        (await tx.organization.findFirst({
          where: {
            AND: [{ id: access.organizationId, status: 'ENABLED' }, buildOrganizationScopeWhere(reads)],
          },
          select: { id: true },
        }))
      )
    )
      return false;
    const targets = await authorization.resolveScopeTargets(this.actor, 'lead', 'lead.create');
    if (targets.all) return true;
    if (
      targets.organizationTargets.length &&
      (await tx.organization.findFirst({
        where: {
          AND: [{ id: access.organizationId, status: 'ENABLED' }, buildOrganizationScopeWhere(targets)],
        },
        select: { id: true },
      }))
    )
      return true;
    return (
      !!this.actor.employeeId &&
      targets.employeeIds.includes(this.actor.employeeId) &&
      (await this.principals(tx)).some(
        (p) => p.principalType === 'ORG' && p.principalId === access.organizationId,
      )
    );
  }
  private async followCustomerScope(access: Access, tx: Tx) {
    const domain = new WorkspaceDomainSource(this.db, this.actor);
    const sources = await tx.collabTable.findMany({ where: {source:'CUSTOMERS', archived:false,base:{workspaceId:access.workspaceId}},select:{id:true}});
    if (!sources.length) return domain.scope('CUSTOMERS',access);
    const scopes: Prisma.Sql[] = [];
    for (const source of sources) {
      try {
        const selected=await this.tableAccess(source.id,tx);
        if (!['name','customerNo'].every(key=>selected.fields.some(f=>object(f.options).businessKey===key && !selected.access.masked?.includes(f.id) && !selected.access.conditional?.includes(f.id)))) continue;
        const allowedViews = await tx.collabView.findMany({where:{tableId:source.id,
          ...(selected.access.viewIds && {id:{in:selected.access.viewIds}}),OR:[{shared:true},{ownerId:this.actor.userId}]},
          orderBy:[{isDefault:'desc'},{position:'asc'},{id:'asc'}],select:{id:true,config:true}});
        if (!allowedViews.length) continue;
        const pref = await tx.collabPreference.findUnique({where:{userId_tableId:{userId:this.actor.userId,tableId:source.id}},select:{viewId:true}});
        const view = allowedViews.find(v=>v.id===pref?.viewId) ?? allowedViews[0];
        const filter = object(view.config).filter;
        const ids=selected.access.rowIds;
        const viewScope = filter ? Prisma.sql`b.id IN (SELECT r.id FROM (${await domain.sourceSql(selected.table,selected.access,selected.fields)}) r
          WHERE ${filterSql(filter,selected.fields,this.actor.userId,this.actor.employeeId)})` : Prisma.sql`TRUE`;
        scopes.push(Prisma.sql`(${await domain.scope('CUSTOMERS',selected.access)} AND ${ids?Prisma.sql`b.id=ANY(${ids}::text[])`:Prisma.sql`TRUE`} AND ${viewScope})`);
      } catch(e) { if (![403,404].includes((e as {status:number}).status)) throw e; }
    }
    return scopes.length ? Prisma.sql`(${Prisma.join(scopes,' OR ')})` : Prisma.sql`FALSE`;
  }
  async followLeadOptions(tableId: string, raw: unknown = {}) {
    const input = exact(raw, ['keyword']);
    const { table, access, fields } = await this.tableAccess(tableId, this.db, 2);
    if (table.source !== 'FOLLOWS' || !(await this.canCreateBusiness(table, access, fields)))
      fail('COLLAB_FORBIDDEN', 403);
    const keyword = input.keyword === undefined || input.keyword === '' ? '' : text(input.keyword, 100);
    if (!this.actor.permissionCodes.includes('customer.read')) return { leads: [] };
    const search = keyword
      ? Prisma.sql`AND (strpos(lower(b.name), lower(${keyword})) > 0 OR strpos(lower(b."customerNo"), lower(${keyword})) > 0)`
      : Prisma.empty;
    const customers = await this.db.$queryRaw<Array<{ id: string; customerNo: string; name: string }>>(
      Prisma.sql`SELECT b.id, b."customerNo", b.name FROM customer b LEFT JOIN lead l ON l.id=b."sourceLeadId"
        WHERE b."deletedAt" IS NULL AND ${await this.followCustomerScope(access,this.db)} ${search}
        ORDER BY b."createdAt" DESC, b.id LIMIT 100`,
    );
    return { leads: customers.map(c => ({ id: c.id, name: c.customerNo + ' · ' + c.name })) };
  }
  private async resolveFollowTarget(tx: Tx, access: Access, targetId: string) {
    if (!this.actor.permissionCodes.includes('customer.read')) fail('COLLAB_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${targetId} FOR UPDATE`;
    const visible = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT b.id FROM customer b LEFT JOIN lead l ON l.id=b."sourceLeadId"
      WHERE b.id=${targetId} AND b."deletedAt" IS NULL AND ${await this.followCustomerScope(access,tx)}`);
    if (!visible.length) fail('COLLAB_NOT_FOUND',404);
    const locked = await tx.customer.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!locked) fail('COLLAB_NOT_FOUND', 404);
    if (locked.sourceLeadId) {
      const linked = await tx.lead.findFirst({ where: { id: locked.sourceLeadId, deletedAt: null }, select: { id: true } });
      if (linked) return linked.id;
    }
    const lead = await tx.lead.create({
      data: {
        leadNo: makeBusinessNo('L'),
        name: locked.name,
        phone: locked.phone,
        phoneHash: locked.phoneHash,
        wechat: locked.wechat,
        sourceType: 'MANUAL',
        status: 'CONTACTED',
        branchId: access.organizationId,
        createdBy: this.actor.userId,
        updatedBy: this.actor.userId,
      },
    });
    // Linking the customer blocks deletion while follows exist, so follow rows cannot be orphaned.
    await tx.customer.update({
      where: { id: locked.id },
      data: { sourceLeadId: lead.id, updatedBy: this.actor.userId, version: { increment: 1 } },
    });
    return lead.id;
  }
  private async createFollowRecord(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['leadId', 'type', 'content', 'nextPlan', 'nextTime']);
    const initial = await this.tableAccess(tableId, this.db, 2);
    return this.write(key, ['follow.create', tableId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId, true);
      const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
      if (table.source !== 'FOLLOWS' || !(await this.canCreateBusiness(table, access, fields, tx)))
        fail('COLLAB_FORBIDDEN', 403);
      for (const fieldName of Object.keys(input))
        if (
          !fields.some((f) => object(f.options).businessKey === fieldName && !access.readonly.includes(f.id))
        )
          fail('COLLAB_FIELD_UNAVAILABLE', 403);
      const leadId = await this.resolveFollowTarget(tx, access, text(input.leadId));
      await tx.$queryRaw`SELECT id FROM lead WHERE id = ${leadId} FOR UPDATE`;
      const lead = await tx.lead.findFirst({
        where: { AND: [{ id: leadId }, await new WorkspaceBusinessTable(this.db, this.actor).scope(access)] },
      });
      if (!lead) fail('COLLAB_NOT_FOUND', 404);
      const created = await new LeadFollowService(
        this.db,
        { actorUserId: this.actor.userId },
        this.actor,
      ).recordFollow(
        leadId,
        {
          type: choice(input.type, LEAD_FOLLOW_TYPES),
          content: text(input.content, 2000),
          nextPlan: input.nextPlan == null || input.nextPlan === '' ? undefined : text(input.nextPlan, 500),
          nextTime:
            input.nextTime == null || input.nextTime === '' ? undefined : new Date(text(input.nextTime)),
        },
        tx,
      );
      await this.checkRowWrite(table,access,tx,created.id,fields.filter(f=>Object.hasOwn(input,String(object(f.options).businessKey))).map(f=>f.id),'add');
      await this.extensionTarget(table, access, created.id, tx);
      await this.event(tx, table.baseId, 'record.created', created.id);
      return { id: created.id };
    });
  }
  private async createCustomerRecord(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name','phone','wechat','email','address','customerType','status','tags','remark','sourceFieldId','sourceValue']);
    const initial = await this.tableAccess(tableId, this.db, 2);
    return this.write(key, ['customer.create', tableId, input], async tx => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
      if (table.source !== 'CUSTOMERS' || access.add === false) fail('COLLAB_FORBIDDEN', 403);
      const { sourceFieldId, sourceValue, ...core } = input;
      if (table.fields.some(f => !f.archived && Object.hasOwn(core, String(object(f.options).businessKey)) && (!fields.some(visible => visible.id === f.id) || access.readonly.includes(f.id)))) fail('COLLAB_FIELD_UNAVAILABLE', 403);
      const customer = await new CustomerService(this.db, { actorUserId: this.actor.userId }, this.actor).createCustomer(core as unknown as CreateCustomerInput, tx);
      await this.extensionTarget(table, access, customer.id, tx);
      await this.checkRowWrite(table, access, tx, customer.id, fields.filter(f => Object.hasOwn(core, String(object(f.options).businessKey))).map(f => f.id), 'add');
      if (sourceValue !== undefined && sourceValue !== null && sourceValue !== '') {
        const field = fields.find(f => f.id === sourceFieldId && f.name === '客户来源' && f.type === 'SINGLE_SELECT' && !object(f.options).businessKey);
        if (!field || access.readonly.includes(field.id)) fail('COLLAB_FIELD_UNAVAILABLE', 403);
        await this.checkRowWrite(table, access, tx, customer.id, [field.id], 'add');
        await this.saveExtension(tableId, customer.id, { values: { [field.id]: sourceValue }, version: customer.version, schemaVersion: table.schemaVersion }, key, tx);
      }
      await this.event(tx, table.baseId, 'record.created', customer.id);
      return customer;
    });
  }
  async createBusinessRecord(tableId: string, raw: unknown, key: unknown) {
    const selected = await this.tableAccess(tableId);
    if (selected.table.source === 'CUSTOMERS') return this.createCustomerRecord(tableId, raw, key);
    if (selected.table.source === 'FOLLOWS') return this.createFollowRecord(tableId, raw, key);
    const input = exact(raw, [
      'name',
      'phone',
      'wechat',
      'intentionLevel',
      'sourceType',
      'sourceDetail',
      'tags',
    ]);
    const initial = await this.tableAccess(tableId);
    if (!(await this.canCreateBusiness(initial.table, initial.access, initial.fields)))
      fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['business.create', tableId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const current = await this.tableAccess(tableId, tx, 2);
      if (!(await this.canCreateBusiness(current.table, current.access, current.fields, tx)))
        fail('COLLAB_FORBIDDEN', 403);
      for (const fieldName of ['wechat', 'intentionLevel'])
        if (
          input[fieldName] !== undefined &&
          !current.fields.some(
            (f) => object(f.options).businessKey === fieldName && !current.access.readonly.includes(f.id),
          )
        )
          fail('COLLAB_FORBIDDEN', 403);
      const created = await new LeadService(
        this.db,
        { actorUserId: this.actor.userId },
        this.actor,
      ).createLead(
        {
          name: text(input.name, 100),
          phone: text(input.phone, 100),
          wechat: input.wechat === undefined ? undefined : text(input.wechat, 100),
          intentionLevel:
            input.intentionLevel === undefined ? undefined : integer(input.intentionLevel, 1, 5),
          sourceDetail: input.sourceDetail === undefined ? undefined : text(input.sourceDetail, 200),
          sourceType:
            input.sourceType === undefined ? undefined : choice(input.sourceType, LEAD_SOURCE_TYPES),
          tags: input.tags === undefined ? undefined : text(input.tags, 500),
          branchId: current.access.organizationId,
        },
        undefined,
        tx,
      );
      await this.checkRowWrite(current.table,current.access,tx,created.lead.id,
        current.fields.filter(f=>Object.hasOwn(input,String(object(f.options).businessKey))).map(f=>f.id),'add');
      // Creating a record never grants a new read scope. Unreadable results roll back with the command.
      await this.businessLead(tableId, created.lead.id, tx);
      const scope = await new WorkspaceBusinessTable(this.db, this.actor).scope(current.access);
      const visibleDuplicates = await tx.lead.count({
        where: {
          AND: [
            scope,
            { id: { in: created.duplicates.map((d) => d.leadId) } },
            ...(current.access.selfOnly ? [{ createdBy: this.actor.userId }] : []),
          ],
        },
      });
      const bases = await tx.collabBase.findMany({
        where: { workspaceId: current.access.workspaceId },
        select: { id: true },
      });
      for (const base of bases) await this.event(tx, base.id, 'business.changed', created.lead.id);
      return { id: created.lead.id, version: created.lead.version, duplicates: visibleDuplicates };
    });
  }
  async createWorkspace(raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'organizationId']);
    if (
      !this.actor.isSystemSuperAdmin &&
      !this.actor.permissionCodes.some((p) => String(p) === 'workspace.create')
    )
      fail('COLLAB_FORBIDDEN', 403);
    const organizationId = text(input.organizationId);
    const name = text(input.name);
    return this.write(key, ['workspace.create', input], async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      if (!org || org.status !== 'ENABLED') fail('COLLAB_ORGANIZATION_UNAVAILABLE');
      if (
        !this.actor.isSystemSuperAdmin &&
        !(await this.principals(tx)).some(
          (p) => p.principalType === 'ORG' && p.principalId === organizationId,
        )
      )
        fail('COLLAB_FORBIDDEN', 403);
      const w = await tx.collabWorkspace.create({
        data: { organizationId, name, ownerId: this.actor.userId },
      });
      await tx.collabMember.create({
        data: {
          workspaceId: w.id,
          principalId: this.actor.userId,
          role: 'OWNER',
          canCreate: true,
          rowScope: 'ALL',
        },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'workspace.created',
          targetType: 'COLLAB',
          targetId: w.id,
        },
      });
      return { id: w.id };
    });
  }
  protected moduleSource(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const source = choice(raw, ['LEADS', 'FOLLOWS', ...Object.keys(domainSources)]);
    new WorkspaceBusinessTable(this.db, this.actor).authorize(source);
    return source;
  }
  async saveBaseModule(baseId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['moduleSource', 'version']);
    const moduleSource = this.moduleSource(input.moduleSource);
    const initial = await this.baseAccess(baseId, this.db, 3);
    return this.write(key, ['base.module', baseId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { base } = await this.baseAccess(baseId, tx, 3);
      await this.assertModuleWorkspace(base.workspaceId, moduleSource, tx);
      if (base.version !== integer(input.version)) fail('COLLAB_DIRECTORY_CONFLICT', 409);
      await tx.collabBase.update({
        where: { id: baseId },
        data: { moduleSource, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'collaboration.base.module',
          targetType: 'COLLAB_BASE',
          targetId: baseId,
          oldValues: JSON.stringify({ moduleSource: base.moduleSource }),
          newValues: JSON.stringify({ moduleSource }),
        },
      });
      await this.event(tx, baseId, 'base.updated', baseId);
      return { id: baseId };
    });
  }
  async createBase(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name']);
    await this.access(workspaceId, this.db, 3);
    return this.write(key, ['base.create', workspaceId, input], async (tx) => {
      await this.lock(tx, workspaceId);
      await this.access(workspaceId, tx, 3);
      const base = await tx.collabBase.create({ data: { workspaceId, name: text(input.name) } });
      await tx.driveNode.create({
        data: {
          id: base.id,
          baseId: base.id,
          workspaceId,
          kind: 'BASE',
          ownerId: this.actor.userId,
          createdAt: new Date(),
        },
      });
      await this.event(tx, base.id, 'base.created', base.id);
      return { id: base.id };
    });
  }
  async tableMoveTargets(tableId:string){
    const initial=await this.tableAccess(tableId,this.db,3);
    if(!initial.access.canManageAccess)fail('COLLAB_FORBIDDEN',403);
    const bases=await this.db.collabBase.findMany({where:{id:{not:initial.table.baseId}},include:{workspace:true},orderBy:{name:'asc'},take:500});
    const targets=[];
    for(const b of bases){try{const allowed=await this.baseAccess(b.id,this.db,3);if(allowed.access.canManageAccess&&!retiredSources.includes(b.moduleSource??''))targets.push({id:b.id,name:b.name,workspaceName:b.workspace.name,moduleSource:b.moduleSource});}catch(e){if((e as {code:string}).code!=='COLLAB_FORBIDDEN')throw e;}}
    return targets;
  }
  private async moveSnapshot(tableId:string,targetBaseId:string,tx:Tx=this.db){
    const {table,access}=await this.tableAccess(tableId,tx,3),destination=await this.baseAccess(targetBaseId,tx,3);
    if(!access.canManageAccess||!destination.access.canManageAccess||table.baseId===targetBaseId||retiredSources.includes(destination.base.moduleSource??''))fail('COLLAB_FORBIDDEN',403);
    if(await tx.collabTable.count({where:{baseId:targetBaseId,name:table.name}}))fail('COLLAB_TABLE_NAME_CONFLICT',409);
    const identity={tableId,sourceBaseId:table.baseId,targetBaseId,tableVersion:table.schemaVersion,accessVersion:table.accessVersion,destinationVersion:destination.base.version,destinationAccessVersion:destination.base.accessVersion};
    return {table,access,destination,previewToken:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
  }
  async previewTableMove(tableId:string,raw:unknown){
    const v=exact(raw,['targetBaseId']),s=await this.moveSnapshot(tableId,text(v.targetBaseId));
    return {previewToken:s.previewToken,sourceBaseId:s.table.baseId,targetBaseId:s.destination.base.id,targetName:s.destination.base.name,
      fields:await this.db.collabField.count({where:{tableId}}),records:await this.db.collabRecord.count({where:{tableId}}),views:await this.db.collabView.count({where:{tableId}}),rules:await this.db.collabRule.count({where:{tableId}})};
  }
  async moveTable(tableId:string,raw:unknown,key:unknown){
    const v=exact(raw,['targetBaseId','previewToken']),targetBaseId=text(v.targetBaseId),initial=await this.moveSnapshot(tableId,targetBaseId);
    return this.write(key,['table.move',tableId,v],async tx=>{
      const currentBase=await tx.collabBase.findUniqueOrThrow({where:{id:initial.table.baseId}});
      for(const id of [...new Set([initial.access.workspaceId,currentBase.workspaceId,initial.destination.base.workspaceId])].sort())await this.lock(tx,id);
      await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${tableId} FOR UPDATE`;
      const current=await this.moveSnapshot(tableId,targetBaseId,tx);
      if(current.previewToken!==text(v.previewToken))fail('COLLAB_DIRECTORY_CONFLICT',409);
      await tx.collabTable.update({where:{id:tableId},data:{baseId:targetBaseId,originBaseId:current.table.originBaseId??current.table.baseId,
        position:await tx.collabTable.count({where:{baseId:targetBaseId}}),accessVersion:{increment:1}}});
      await tx.operationLog.create({data:{userId:this.actor.userId,action:'WORKSHEET_MOVE',targetType:'COLLAB_TABLE',targetId:tableId,
        oldValues:JSON.stringify({baseId:current.table.baseId}),newValues:JSON.stringify({baseId:targetBaseId,originBaseId:current.table.originBaseId??current.table.baseId})}});
      await this.event(tx,current.table.baseId,'access.updated',tableId);await this.event(tx,targetBaseId,'access.updated',tableId);
      return {id:tableId,baseId:targetBaseId,moduleSource:current.destination.base.moduleSource};
    });
  }
  async listTables(baseId: string, tx: Tx = this.db) {
    const { base, access } = await this.baseAccess(baseId, tx);
    const tables = await tx.collabTable.findMany({
      where: { baseId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, source: true, originBaseId:true, lifecycleKind: true, inventoryKind: true, position: true, schemaVersion: true, archived: true },
    });
    const visible: Array<(typeof tables)[number] & { canManage: boolean; canDelete: boolean }> = [];
    for (const table of tables) {
      try {
        const result = await this.tableAccess(table.id, tx, 1, true);
        if (!table.archived || result.access.level >= 3)
          visible.push({
            ...table,
            canManage: access.level >= 3 && result.access.level >= 3,
            canDelete:
              result.access.level >= 3 &&
              !result.access.selfOnly &&
              !result.access.hidden.length &&
              !result.access.readonly.length,
          });
      } catch (error) {
        if (!['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((error as { code?: string }).code ?? ''))
          throw error;
      }
    }
    const orderToken = createHash('sha256')
      .update(JSON.stringify(tables.map((t) => [t.id, t.position, t.archived])))
      .digest('hex');
    return { base: { ...base, accessPolicy: null as null }, access, tables: visible, orderToken };
  }
  async reorderTables(baseId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['order', 'orderToken']);
    const order = strings(input.order, 1000);
    if (!order.length || order.length !== (input.order as unknown[]).length)
      fail('COLLAB_INVALID_DIRECTORY_ORDER');
    const orderToken = text(input.orderToken);
    const verify = (directory: Awaited<ReturnType<CollaborationService['listTables']>>) => {
      if (directory.access.level < 3) fail('COLLAB_FORBIDDEN', 403);
      const movable = directory.tables.filter((t) => t.canManage && !t.archived).map((t) => t.id);
      if (order.length !== movable.length || order.some((id) => !movable.includes(id)))
        fail('COLLAB_INVALID_DIRECTORY_ORDER', 403);
    };
    const initial = await this.listTables(baseId);
    verify(initial);
    return this.write(key, ['directory.reorder', baseId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const current = await this.listTables(baseId, tx);
      verify(current);
      if (orderToken !== current.orderToken) fail('COLLAB_DIRECTORY_CONFLICT', 409);
      const all = await tx.collabTable.findMany({
        where: { baseId },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const movable = new Set(order);
      let index = 0;
      for (const [position, slot] of all.entries()) {
        const id = movable.has(slot.id) ? order[index++] : slot.id;
        await tx.collabTable.update({ where: { id }, data: { position } });
      }
      await this.event(tx, baseId, 'directory.updated', baseId);
      return { order };
    });
  }
  private lifecycle() {
    return new LifecycleWorksheet(this.db, this.actor, (id, tx) => this.tableAccess(id, tx ?? this.db));
  }
  async configureLifecycle(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['kind', 'schemaVersion']);
    const kind = choice(input.kind, lifecycleKinds);
    this.lifecycle().authorize(kind);
    return this.write(key, ['lifecycle.configure', tableId, input], async (tx) => {
      const initial = await this.tableAccess(tableId, tx, 3);
      await this.lock(tx, initial.access.workspaceId);
      const { table, access } = await this.tableAccess(tableId, tx, 3);
      if (access.selfOnly || access.hidden.length || access.readonly.length) fail('COLLAB_FORBIDDEN', 403);
      if (
        table.source !== 'CUSTOM' ||
        !!table.inventoryKind ||
        (table.lifecycleKind === 'CASE_REFUNDS' && kind !== table.lifecycleKind) ||
        table.schemaVersion !== integer(input.schemaVersion)
      )
        fail('COLLAB_SCHEMA_CONFLICT', 409);
      if (await tx.collabRecord.count({ where: { tableId } })) fail('LIFECYCLE_TABLE_NOT_EMPTY', 409);
      if (table.lifecycleKind) this.lifecycle().authorize(table.lifecycleKind);
      const existing = await tx.collabField.findMany({ where: { tableId } });
      // Preserve existing columns and views; only remove obsolete required flags on an empty table.
      await tx.collabField.updateMany({ where: { tableId }, data: { required: false } });
      for (const f of lifecycleFields(kind)) {
        const fieldKey = String(object(f.options).lifecycleKey);
        const previous = existing.find((field) => lifecycleKey(field) === fieldKey) ??
          (kind === 'CASE_REFUNDS' ? existing.find(field => lifecycleKey(field) === ({feeTotalLookup:'feeTotal',refundReceiptLookup:'refundReceipt'} as Record<string,string>)[fieldKey]) : undefined);
        if (existing.some((field) => field.name === f.name && field.id !== previous?.id))
          fail('LIFECYCLE_FIELD_NAME_CONFLICT', 409);
        if (previous)
          await tx.collabField.update({ where: { id: previous.id }, data: { ...f, archived: false } });
        else await tx.collabField.create({ data: { ...f, tableId } });
      }
      await tx.collabTable.update({
        where: { id: tableId },
        data: { lifecycleKind: kind, schemaVersion: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'WORKSHEET_LINK_CONFIGURE',
          targetType: 'COLLAB_TABLE',
          targetId: tableId,
          oldValues: JSON.stringify({ kind: table.lifecycleKind }),
          newValues: JSON.stringify({ kind }),
        },
      });
      await this.event(tx, table.baseId, 'table.updated', tableId);
      return { id: tableId };
    });
  }
  async lifecycleChoices(tableId: string, raw: unknown) {
    const input = exact(raw, ['keyword', 'page']);
    const { table, access, fields } = await this.tableAccess(tableId);
    if (!table.lifecycleKind || !fields.some((f) => lifecycleKey(f) === 'upstreamId'))
      fail('COLLAB_FORBIDDEN', 403);
    return this.lifecycle().choices(
      table,
      access,
      fields,
      String(input.keyword ?? '').slice(0, 100),
      integer(Number(input.page ?? 1), 1, 100000),
    );
  }
  async createTable(baseId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'template', 'source']);
    const source = choice(input.source ?? 'CUSTOM', [
      'CUSTOM',
      'LEADS',
      'FOLLOWS',
      ...Object.keys(domainSources),
    ]);
    // The administrative module now stores expenses in its own editable worksheet.
    if (source === 'INVENTORY_MOVEMENTS' || source === 'INVENTORY_STOCKTAKES') fail('COLLAB_INVALID_SOURCE');
    if (retiredSources.includes(source)) fail('MODULE_RETIRED',409);
    if (source !== 'CUSTOM') new WorkspaceBusinessTable(this.db, this.actor).authorize(source);
    const initial = await this.baseAccess(baseId);
    if (!initial.access.canCreate || (source !== 'CUSTOM' && initial.access.level < 4))
      fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['table.create', baseId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { access, base } = await this.baseAccess(baseId, tx);
      if (base.moduleSource === 'INVENTORY_STOCKTAKES' && !canManageHr(this.actor)) fail('COLLAB_FORBIDDEN',403);
      if (source !== 'CUSTOM') await this.assertModuleWorkspace(base.workspaceId, source, tx);
      if (!access.canCreate || (source !== 'CUSTOM' && access.level < 4)) fail('COLLAB_FORBIDDEN', 403);
      const table = await tx.collabTable.create({
        data: {
          baseId,
          source,
          name: text(input.name),
          createdBy: this.actor.userId,
          position: await tx.collabTable.count({ where: { baseId } }),
        },
      });
      if (source !== 'CUSTOM') {
        await tx.collabField.createMany({
          data: businessFields(source).map((f) => ({ ...f, tableId: table.id })),
        });
      } else {
        const template = choice(input.template ?? 'BLANK', ['BLANK', 'TASKS', 'CONTACTS', lawyerProspectTemplate, ...lifecycleKinds, ...followSupportKinds, ...inventoryKinds]);
        if (inventoryKinds.includes(template as InventoryKind)) {
          if (isCaseArchiveKind(template)) {
            const workspace = await tx.collabWorkspace.findUniqueOrThrow({where:{id:base.workspaceId}});
            if (workspace.moduleGroup !== 'CASES' || base.moduleSource !== 'CASES') fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
          }
          if (isHrKind(template) && !canManageHr(this.actor)) fail('COLLAB_FORBIDDEN',403);
          new WorkspaceBusinessTable(this.db, this.actor).authorize(isCaseArchiveKind(template) ? 'CASES' : isHrKind(template) ? 'INVENTORY_STOCKTAKES' : 'INVENTORY_ITEMS');
          await this.assertModuleWorkspace(base.workspaceId, isCaseArchiveKind(template) ? 'CASES' : isHrKind(template) ? 'INVENTORY_STOCKTAKES' : isAdministrativeKind(template) ? 'INVENTORY_MOVEMENTS' : 'INVENTORY_ITEMS', tx);
          await tx.collabTable.update({ where: { id: table.id }, data: { inventoryKind: template } });
          await tx.collabField.createMany({ data: inventoryFields(template as InventoryKind).map(f => ({...f, tableId: table.id})) });
          if (isInventorySummary(template)) await seedInventorySummary(tx, table.id, this.actor.userId);
        } else if (template === lawyerProspectTemplate) {
          await tx.collabField.createMany({ data: lawyerProspectFields().map(f => ({...f, tableId: table.id})) });
        } else if (followSupportKinds.includes(template as FollowSupportKind)) {
          await tx.collabTable.update({where:{id:table.id},data:{followSupportKind:template}});
          await tx.collabField.createMany({ data: followSupportFields(template as FollowSupportKind).map(f => ({...f, tableId: table.id})) });
        } else if (lifecycleKinds.includes(template as LifecycleKind)) {
          this.lifecycle().authorize(template);
          await tx.collabTable.update({ where: { id: table.id }, data: { lifecycleKind: template } });
          await tx.collabField.createMany({
            data: lifecycleFields(template as LifecycleKind).map((f) => ({ ...f, tableId: table.id })),
          });
        } else {
          await tx.collabField.create({
            data: { tableId: table.id, name: '标题', type: 'TEXT', required: true },
          });
          if (template !== 'BLANK') {
            await tx.collabField.create({
              data: { tableId: table.id, name: '负责人', type: 'USER', position: 1 },
            });
            await tx.collabField.create({
              data: {
                tableId: table.id,
                name: template === 'TASKS' ? '截止日期' : '下次联系',
                type: 'DATE',
                position: 2,
              },
            });
            await tx.collabField.create({
              data: {
                tableId: table.id,
                name: '状态',
                type: 'SINGLE_SELECT',
                position: 3,
                options: {
                  choices: [
                    { id: 'todo', name: '待处理' },
                    { id: 'doing', name: '进行中' },
                    { id: 'done', name: '已完成' },
                  ],
                },
              },
            });
          }
        }
      }
      const view = await tx.collabView.create({
        data: { tableId: table.id, name: '总表', ownerId: this.actor.userId, shared: true, isDefault: true,
          ...((source === 'CASES' || lifecycleKinds.includes(input.template as LifecycleKind)) ? {
            config: { visibleFields: (await tx.collabField.findMany({ where: { tableId: table.id }, orderBy: { position: 'asc' } }))
              .filter(f => source === 'CASES' ? CASE_FIELD_ORDER.includes(String(object(f.options).businessKey)) : object(f.options).defaultVisible === true).map(f => f.id) },
          } : {}),
        },
      });
      await initializeTablePolicies(tx,table,base.workspaceId,this.actor.userId);
      await this.event(tx, baseId, 'table.created', table.id);
      return { id: table.id, viewId: view.id };
    });
  }
  async describe(tableId: string) {
    const { table, access, fields } = await this.tableAccess(tableId);
    const views = await this.db.collabView.findMany({
      where: { tableId, ...(access.viewIds && {id:{in:access.viewIds}}), OR: [{ shared: true }, { ownerId: this.actor.userId }] },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const preference = await this.db.collabPreference.findUnique({
      where: { userId_tableId: { userId: this.actor.userId, tableId } },
    });
    return {
      table: { ...table, accessPolicy: null as null, fields: [] as CollabField[] },
      businessPermissions: this.actor.permissionCodes,
      canDeleteRecords: access.remove !== false &&
        (!isHrKind(table.inventoryKind) || canManageHr(this.actor)) &&
        !isInventorySummary(table.inventoryKind) &&
        access.level >= 2 &&
        ((table.source === 'CUSTOM' && (!table.lifecycleKind || this.actor.permissionCodes.includes(table.lifecycleKind === 'AFTER_SALES' ? 'case.delete' : 'refund.create'))) ||
          (table.source === 'CASES' && this.actor.permissionCodes.includes('case.delete')) ||
          (table.source === 'PAYMENTS' && this.actor.permissionCodes.includes('payment.void')) ||
          (table.source === 'NEGOTIATIONS' && this.actor.permissionCodes.includes('negotiation.delete')) ||
          (table.source === 'CONTRACTS' && this.actor.permissionCodes.includes('contract.delete')) ||
          (table.source === 'COSTS' && this.actor.permissionCodes.includes('cost.delete')) ||
          (table.source === 'CUSTOMERS' && this.actor.permissionCodes.includes('customer.delete')) ||
          (table.source === 'CHANNELS' && this.actor.permissionCodes.includes('channel.delete')) ||
          (table.source === 'LEADS' && this.actor.permissionCodes.includes('lead.delete')) ||
          (table.source === 'FOLLOWS' && this.actor.permissionCodes.includes('lead.follow.delete'))),
      access: publicAccess(access),
      canCreateBusiness: await this.canCreateBusiness(table, access, fields),
      fields: fields.map((f) => ({
        ...f,
        ...(table.source === 'FOLLOWS' && object(f.options).businessKey === 'type'
          ? { type: 'SINGLE_SELECT', options: { ...object(f.options), choices: followTypeChoices } } : {}),
        ...(businessGridChoices(table.source, String(object(f.options).businessKey))
          ? {
              type: 'SINGLE_SELECT',
              options: {
                ...object(f.options),
                choices: businessGridChoices(table.source, String(object(f.options).businessKey)),
              },
            }
          : {}),
        ...(table.source === 'CASES' && caseGridChoices(String(object(f.options).businessKey))
          ? {
              type: ['intake.agencyProcedure', 'intake.receiptMethod', 'intake.receiptAccount'].includes(String(object(f.options).businessKey)) ? 'MULTI_SELECT' : 'SINGLE_SELECT',
              options: {
                ...object(f.options),
                choices: caseGridChoices(String(object(f.options).businessKey)),
              },
            }
          : {}),
        name:
          table.source === 'FOLLOWS' && object(f.options).businessKey === 'leadId' && f.name === '线索 ID'
            ? '关联线索'
            : f.name,
        queryable:
          !object(f.options).worksheetMasked && !object(f.options).conditionalField && !hrPrivate(f) && !object(f.options).hrAge && (table.source === 'CUSTOM' || !['phone', 'wechat'].includes(String(object(f.options).businessKey))),
        writable:
          (table.source === 'CUSTOM' ||
            (table.source === 'PAYMENTS' && paymentWorksheetKeys.includes(String(object(f.options).businessKey)) && this.actor.permissionCodes.includes('payment.confirm')) ||
            (table.source === 'REFUNDS' && refundExecutionKeys.includes(String(object(f.options).businessKey)) && this.actor.permissionCodes.includes('refund.execute')) ||
            (editableCrmKey(table.source, String(object(f.options).businessKey), this.actor) &&
              this.actor.permissionCodes.includes('lead.update')) ||
            (isEditableBusinessSource(table.source) &&
              editableBusinessKey(table.source, String(object(f.options).businessKey), this.actor) &&
              this.actor.permissionCodes.includes(domainSources[table.source].edit)) ||
            (table.source === 'CASES' &&
              editableCaseKey(String(object(f.options).businessKey), this.actor) &&
              this.actor.permissionCodes.includes('case.update')) ||
            (!object(f.options).businessKey &&
              this.actor.permissionCodes.includes(
                isDomainSource(table.source) ? domainSources[table.source].edit : 'lead.update',
              ))) &&
          access.level >= 2 &&
          !access.readonly.includes(f.id) &&
          !isSystemField(f) && !syncedLifecycleKeys.includes(lifecycleKey(f)) && (!table.lifecycleKind || this.actor.permissionCodes.includes('case.update') && (table.lifecycleKind !== 'CASE_REFUNDS' || this.actor.permissionCodes.includes('refund.create'))),
      })),
      views: views.map((v) => ({ ...v, config: this.sanitizeConfig(v.config, fields) })),
      preferredViewId: views.some(v=>v.id===preference?.viewId) ? preference?.viewId : views[0]?.id,
      userId: this.actor.userId,
      employeeId: this.actor.employeeId,
    };
  }
  private sanitizeConfig(raw: unknown, fields: CollabField[]): ViewConfig {
    const c = object(raw) as ViewConfig;
    const ids = new Set(fields.map((f) => f.id));
    // A shared filter mentioning a forbidden field cannot be exposed or silently removed.
    if (c.filter) {
      try {
        filterSql(c.filter, fields, this.actor.userId, this.actor.employeeId);
      } catch {
        return { visibleFields: [], filter: { fieldId: '__restricted__', operator: 'eq', value: '' } };
      }
    }
    return {
      ...c,
      dateFieldId: ids.has(c.dateFieldId) ? c.dateFieldId : undefined,
      endDateFieldId: ids.has(c.endDateFieldId) ? c.endDateFieldId : undefined,
      colorFieldId: ids.has(c.colorFieldId) ? c.colorFieldId : undefined,
      visibleFields: c.visibleFields?.filter((id) => ids.has(id)),
      groupBy: c.groupBy?.filter((id) => ids.has(id)),
      sorts: c.sorts?.filter((s) => ids.has(s.fieldId)),
      widths: c.widths
        ? Object.fromEntries(Object.entries(c.widths).filter(([id]) => ids.has(id)))
        : undefined,
    };
  }
  async mutateTable(tableId: string, raw: unknown, key: unknown) {
    if (object(raw).remove === true) return this.deleteTable(tableId, raw, key);
    const input = exact(raw, ['name', 'position', 'archived', 'duplicate', 'version']);
    if (input.position !== undefined) fail('COLLAB_USE_DIRECTORY_ORDER');
    const initial = await this.tableAccess(tableId, this.db, 3, true);
    return this.write(key, ['table.update', tableId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table } = await this.tableAccess(tableId, tx, 3, true);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      if (input.duplicate) {
        if (table.source !== 'CUSTOM') fail('COLLAB_USE_BUSINESS_ACTION', 409);
        const visible = await this.tableAccess(tableId, tx);
        if (visible.access.copy===false || visible.access.hidden.length || visible.access.masked?.length || visible.access.conditional?.length || visible.access.viewIds) fail('COLLAB_FORBIDDEN', 403);
        const copy = await tx.collabTable.create({
          data: {
            baseId: table.baseId,
            lifecycleKind: table.lifecycleKind,
            followSupportKind:table.followSupportKind,originBaseId:table.originBaseId,
            inventoryKind: table.inventoryKind,
            name: text(input.name),
            createdBy: this.actor.userId,
            position: table.position + 1,
          },
        });
        const mapping = new Map<string, string>();
        for (const f of table.fields.filter((f) => !f.archived)) {
          const id = randomUUID();
          mapping.set(f.id, id);
          await tx.collabField.create({
            data: {
              ...f,
              id,
              tableId: copy.id,
              defaultValue: f.defaultValue === null ? Prisma.DbNull : json(f.defaultValue),
            },
          });
        }
        const views = await tx.collabView.findMany({ where: { tableId, shared: true } });
        for (const v of views) {
          let config = JSON.stringify(v.config);
          for (const [oldId, id] of mapping) config = config.replaceAll(oldId, id);
          await tx.collabView.create({
            data: {
              ...v,
              id: randomUUID(),
              tableId: copy.id,
              ownerId: this.actor.userId,
              config: JSON.parse(config),
              version: 1,
            },
          });
        }
        if (isInventorySummary(copy.inventoryKind)) await seedInventorySummary(tx, copy.id, this.actor.userId);
        await this.event(tx, table.baseId, 'table.created', copy.id);
        return { id: copy.id };
      }
      if (input.archived === true) {
        const references = await tx.collabField.count({
          where: {
            archived: false,
            type: 'RELATION',
            options: { path: ['targetTableId'], equals: tableId },
            tableId: { not: tableId },
          },
        });
        if (references || await tx.collabLifecycleLink.count({where:{parent:{tableId},record:{archived:false}}})) fail('COLLAB_REFERENCED_TABLE', 409, { references });
        if (await tx.collabRule.count({ where: { tableId, enabled: true } })) fail('COLLAB_ACTIVE_RULE', 409);
      }
      await tx.collabTable.update({
        where: { id: tableId },
        data: {
          name: input.name === undefined ? undefined : text(input.name),
          position: input.position === undefined ? undefined : integer(input.position, 0),
          archived: input.archived === undefined ? undefined : boolean(input.archived),
          schemaVersion: { increment: 1 },
        },
      });
      await this.event(tx, table.baseId, 'table.updated', tableId);
      return { id: tableId, version: table.schemaVersion + 1 };
    });
  }
  private async deleteTable(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['remove', 'version']);
    // The actor-bound receipt survives deletion, including retries of file cleanup.
    const receipt = await this.write(key, ['table.delete', tableId, input], async (tx) => {
      const initial = await this.tableAccess(tableId, tx, 3, true);
      await this.lock(tx, initial.access.workspaceId);
      const { table, access } = await this.tableAccess(tableId, tx, 3, true);
      if (access.selfOnly || access.hidden.length || access.readonly.length) fail('COLLAB_FORBIDDEN', 403);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      if (table.lifecycleKind && await tx.collabRecord.count({where:{tableId}})) fail('LIFECYCLE_TABLE_HAS_RECORDS',409);
      // Archived fields also retain references and must not become dangling on restore.
      const reference = await tx.collabField.findFirst({
        where: {
          tableId: { not: tableId },
          options: { path: ['targetTableId'], equals: tableId },
        },
      });
      const linked = await tx.collabRelation.findFirst({
        where: {
          target: { tableId },
          source: { tableId: { not: tableId } },
        },
      });
      const lifecycleChildren = await tx.collabLifecycleLink.count({where:{parent:{tableId},tableId:{not:tableId}}});
      if (reference || linked || lifecycleChildren) fail('COLLAB_REFERENCED_TABLE', 409);
      const files = await tx.collabAttachment.findMany({ where: { tableId }, select: { storageKey: true } });
      if (files.some((file) => !/^[a-f0-9-]{36}$/i.test(file.storageKey)))
        fail('DRIVE_FILE_CLEANUP_FAILED', 500);
      await tx.collabRelation.deleteMany({ where: { source: { tableId } } });
      await tx.collabAttachment.deleteMany({ where: { tableId } });
      await tx.collabPreference.deleteMany({ where: { tableId } });
      // Only collaboration data cascades; canonical business records have no table FK.
      await tx.collabRecordOperation.deleteMany({ where: { tableId } });
      await tx.collabTable.delete({ where: { id: tableId } });
      await tx.operationLog.create({ data: {
        userId: this.actor.userId, action: 'WORKSHEET_DELETE', targetType: 'COLLAB_TABLE', targetId: tableId,
        oldValues: JSON.stringify({ name: table.name, source: table.source, lifecycleKind: table.lifecycleKind, baseId: table.baseId }),
      } });
      await this.event(tx, table.baseId, 'table.deleted', tableId);
      return { id: tableId, files: files.map((file) => file.storageKey) };
    });
    for (const storageKey of receipt.files) {
      try {
        await unlink(path.join(process.cwd(), 'var', 'storage', 'collaboration', storageKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('DRIVE_FILE_CLEANUP_FAILED', 500);
      }
    }
    return { id: receipt.id };
  }
  async saveField(tableId: string, fieldId: string | undefined, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'name',
      'type',
      'required',
      'options',
      'defaultValue',
      'position',
      'archived',
      'version',
    ]);
    const initial = await this.tableAccess(tableId, this.db, 3);
    if (initial.table.inventoryKind) fail('COLLAB_READONLY_FIELD', 403);
    return this.write(key, ['field.save', tableId, fieldId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, fields } = await this.tableAccess(tableId, tx, 3);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      const previous = fieldId ? table.fields.find((f) => f.id === fieldId) : undefined;
      if (fieldId && !previous) fail('COLLAB_NOT_FOUND', 404);
      if (fieldId && !fields.some((f) => f.id === fieldId)) fail('COLLAB_FORBIDDEN', 403);
      if (previous && (object(previous.options).businessKey || object(previous.options).customerRouteKey || lifecycleKey(previous))) fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const type = choice(input.type ?? previous?.type, FIELD_TYPES);
      if (type === 'FORMULA') fail('COLLAB_READONLY_FIELD', 403);
      if (table.source !== 'CUSTOM' && isSystemField({ type })) fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const countValues = (values: Prisma.JsonFilter) =>
        table.source === 'CUSTOM'
          ? tx.collabRecord.count({ where: { tableId, values } })
          : tx.collabExtension.count({ where: { tableId, values } });
      if (
        previous &&
        previous.type !== type &&
        (await countValues({ path: [previous.id], not: Prisma.DbNull }))
      )
        fail('COLLAB_FIELD_MIGRATION_REQUIRED', 409);
      const required = input.required === undefined ? (previous?.required ?? false) : boolean(input.required);
      if (table.source === 'CUSTOM' && required && !previous?.required) {
        const missing = await tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*) FROM collab_record WHERE "tableId" = ${tableId} AND archived = false AND ("values" ->> ${fieldId ?? ''} IS NULL OR "values" ->> ${fieldId ?? ''} IN ('', '[]'))`,
        );
        if (Number(missing[0].count)) fail('COLLAB_REQUIRED_BACKFILL_REQUIRED', 409);
      }
      const options = validateOptions(type, input.options ?? previous?.options ?? {});
      if (previous && ['SINGLE_SELECT', 'MULTI_SELECT'].includes(type)) {
        const nextIds = new Set((options.choices as Array<{ id: string }>).map((o) => o.id));
        const removed = ((object(previous.options).choices ?? []) as Array<{ id: string }>).filter(
          (o) => !nextIds.has(o.id),
        );
        for (const option of removed)
          if (
            await countValues(
              type === 'SINGLE_SELECT'
                ? { path: [previous.id], equals: option.id }
                : { path: [previous.id], array_contains: [option.id] },
            )
          )
            fail('COLLAB_OPTION_IN_USE', 409);
      }
      if (
        previous?.type === 'RELATION' &&
        (options.targetTableId !== object(previous.options).targetTableId || options.targetSource !== object(previous.options).targetSource) &&
        (await countValues({ path: [previous.id], not: Prisma.DbNull }))
      )
        fail('COLLAB_FIELD_MIGRATION_REQUIRED', 409);
      if (type === 'RELATION' && !options.targetSource) {
        const target = await this.tableAccess(text(options.targetTableId), tx);
        if (target.table.source !== 'CUSTOM' || target.table.lifecycleKind) fail('COLLAB_CORE_RELATION_UNSUPPORTED');
        if (target.access.workspaceId !== initial.access.workspaceId) fail('COLLAB_CROSS_WORKSPACE_RELATION');
      }
      if (input.archived === true && previous) {
        if (previous.position === 0) fail('COLLAB_TITLE_FIELD_REQUIRED', 409);
        const views = await tx.collabView.findMany({ where: { tableId } });
        if (
          views.some(
            (v) =>
              JSON.stringify(object(v.config).filter ?? {}).includes(previous.id) ||
              JSON.stringify(object(v.config).sorts ?? []).includes(previous.id) ||
              JSON.stringify(object(v.config).groupBy ?? []).includes(previous.id),
          )
        )
          fail('COLLAB_REFERENCED_FIELD', 409);
      }
      if (!fieldId && table.fields.filter((f) => !f.archived).length >= 100) fail('COLLAB_FIELD_LIMIT');
      const data = {
        name: text(input.name ?? previous?.name),
        type,
        required,
        options: json(options),
        position:
          input.position === undefined
            ? (previous?.position ?? table.fields.length)
            : integer(input.position, 0),
        archived: input.archived === undefined ? (previous?.archived ?? false) : boolean(input.archived),
      };
      const fake = { ...previous, ...data, id: fieldId ?? 'new' } as CollabField;
      const defaultValue = input.defaultValue === undefined ? previous?.defaultValue : input.defaultValue;
      const validatedDefault =
        defaultValue === null || defaultValue === undefined
          ? Prisma.DbNull
          : json(validateValue(fake, defaultValue));
      const field = fieldId
        ? await tx.collabField.update({
            where: { id: fieldId },
            data: { ...data, defaultValue: validatedDefault },
          })
        : await tx.collabField.create({ data: { ...data, tableId, defaultValue: validatedDefault } });
      if (!previous && !field.archived) {
        // Explicit column lists otherwise permanently hide every later field.
        const defaults = await tx.collabView.findMany({ where: { tableId, isDefault: true } });
        for (const view of defaults) {
          const config = object(view.config);
          if (Array.isArray(config.visibleFields) && !config.visibleFields.includes(field.id))
            await tx.collabView.update({ where: { id: view.id }, data: {
              config: json({ ...config, visibleFields: [...config.visibleFields, field.id] }),
              version: { increment: 1 },
            } });
        }
      }
      await tx.collabTable.update({ where: { id: tableId }, data: { schemaVersion: { increment: 1 } } });
      await this.event(tx, table.baseId, 'schema.updated', tableId);
      return { id: field.id, version: table.schemaVersion + 1 };
    });
  }
  async saveView(tableId: string, viewId: string | undefined, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'name',
      'type',
      'shared',
      'config',
      'position',
      'version',
      'remove',
      'default',
    ]);
    const initial = await this.tableAccess(tableId);
    return this.write(key, ['view.save', tableId, viewId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, access, fields } = await this.tableAccess(tableId, tx);
      if (access.viewIds && (!viewId || !access.viewIds.includes(viewId))) fail('COLLAB_FORBIDDEN',403);
      const previous = viewId
        ? await tx.collabView.findFirst({
            where: { id: viewId, tableId, OR: [{ shared: true }, { ownerId: this.actor.userId }] },
          })
        : null;
      if (viewId && !previous) fail('COLLAB_NOT_FOUND', 404);
      if (input.default && previous) {
        await tx.collabPreference.upsert({
          where: { userId_tableId: { userId: this.actor.userId, tableId } },
          create: { userId: this.actor.userId, tableId, viewId },
          update: { viewId },
        });
        return { id: viewId };
      }
      const shared = input.shared === undefined ? (previous?.shared ?? false) : boolean(input.shared);
      if ((shared || previous?.shared) && access.level < 3) fail('COLLAB_FORBIDDEN', 403);
      if (previous && !previous.shared && previous.ownerId !== this.actor.userId)
        fail('COLLAB_FORBIDDEN', 403);
      if (previous && previous.version !== integer(input.version)) fail('COLLAB_VIEW_CONFLICT', 409);
      if (previous?.isDefault && (input.remove || !shared)) fail('COLLAB_DEFAULT_VIEW_REQUIRED', 409);
      if (input.remove && previous) {
        await tx.collabView.delete({ where: { id: viewId } });
        await this.event(tx, table.baseId, 'view.updated', tableId);
        return { id: viewId };
      }
      const config = validateView(input.config ?? previous?.config ?? {}, fields);
      if (table.source !== 'CUSTOM')
        new WorkspaceBusinessTable(this.db, this.actor).validateConfig(table.source, fields, config);
      const data = {
        name: text(input.name ?? previous?.name),
        type: choice(input.type ?? previous?.type ?? 'GRID', VIEW_TYPES),
        shared,
        config: json(config),
        position: input.position === undefined ? (previous?.position ?? 0) : integer(input.position, 0),
      };
      const view = previous
        ? await tx.collabView.update({ where: { id: viewId }, data: { ...data, version: { increment: 1 } } })
        : await tx.collabView.create({ data: { ...data, tableId, ownerId: this.actor.userId } });
      await this.event(tx, table.baseId, 'view.updated', tableId);
      return { id: view.id, version: view.version };
    });
  }
  private rowWhere(tableId: string, access: Access): Prisma.CollabRecordWhereInput {
    return { tableId, archived: false, ...(access.rowIds && { AND: [{id:{in:access.rowIds}}] }), ...(access.selfOnly ? { createdBy: this.actor.userId } : {}) };
  }
  async attachment(tableId: string, fileId: string, tx: Tx = this.db): Promise<import('@prisma/client').CollabAttachment> {
    const { access, fields: visibleFields, table } = await this.tableAccess(tableId, tx);
    const fields = visibleFields.filter(f => !object(f.options).worksheetMasked && !object(f.options).conditionalField);
    const scope = access.rowIds ? Prisma.sql`r.id = ANY(${access.rowIds}::text[])` : Prisma.sql`TRUE`;
    if (isHrKind(table.inventoryKind) && !canReadHrPrivate(this.actor)) fail('COLLAB_FORBIDDEN',403);
    const file = await tx.collabAttachment.findFirst({ where: { id: fileId, tableId } });
    if (!file && (['CASES','PAYMENTS','REFUNDS','FOLLOWS'].includes(table.source) || table.lifecycleKind === 'CASE_REFUNDS')) {
      const lookup = fields.find(f => table.source === 'CASES' ? object(f.options).businessKey === 'receiptFiles' : table.source !== 'CUSTOM' ? object(f.options).businessKey === (table.source === 'FOLLOWS' ? 'attachments' : 'voucherFiles') : lifecycleKey(f) === 'refundReceiptLookup');
      if (!lookup) fail('COLLAB_FORBIDDEN',403);
      const source = table.source !== 'CUSTOM' ? await new WorkspaceBusinessTable(this.db,this.actor).sourceSql(table,access,fields) : await this.lifecycle().sourceSql(table,access,fields);
      const visible = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT r.id FROM (${source}) r WHERE r.archived=false AND ${scope} AND ${access.selfOnly ? Prisma.sql`r."createdBy"=${this.actor.userId}` : Prisma.sql`TRUE`} AND r.values->${lookup.id} @> ${JSON.stringify([fileId])}::jsonb LIMIT 1`);
      if(!visible.length) fail('COLLAB_FORBIDDEN',403);
      const original = await tx.collabAttachment.findUnique({where:{id:fileId}});
      if(!original) fail('COLLAB_NOT_FOUND',404);
      return original;
    }
    if (!file) fail('COLLAB_NOT_FOUND', 404);
    if (table.source !== 'CUSTOM') {
      const source = await new WorkspaceBusinessTable(this.db, this.actor).sourceSql(table, access, fields);
      const visible = fields
        .filter((f) => f.type === 'FILE')
        .map((f) => Prisma.sql`r."values" -> ${f.id} @> ${JSON.stringify([fileId])}::jsonb`);
      const permitted = visible.length
        ? await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`WITH r AS (${source}) SELECT id FROM r WHERE ${scope} AND (${Prisma.join(visible, ' OR ')}) LIMIT 1`,
          )
        : [];
      if (!permitted.length) {
        const referenced = await tx.collabExtension.count({
          where: {
            tableId,
            OR: table.fields
              .filter((f) => f.type === 'FILE')
              .map((f) => ({ values: { path: [f.id], array_contains: [fileId] } })),
          },
        });
        const followReferences = await tx.leadFollow.count({where:{profile:{path:['attachments'],array_contains:[fileId]}}});
        const financialReferences = await tx.payment.count({where:{voucherFiles:{array_contains:[fileId]}}}) + await tx.refundRequest.count({where:{voucherFiles:{array_contains:[fileId]}}});
        if (referenced || followReferences || financialReferences || file.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
      }
      return file;
    }
    const references = (items: CollabField[]) =>
      items
        .filter((f) => f.type === 'FILE')
        .map((f) => ({ values: { path: [f.id], array_contains: [fileId] } }));
    const visible = await tx.collabRecord.findFirst({
      where: { ...this.rowWhere(tableId, access), OR: references(fields) },
      select: { id: true },
    });
    if (visible && table.lifecycleKind) {
      const rows = await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT r.id FROM (${await this.lifecycle().sourceSql(table,access,fields)}) r WHERE r.id=${visible.id}`);
      if (!rows.length) fail('COLLAB_FORBIDDEN',403);
    }
    if (!visible) {
      const referenced = await tx.collabRecord.count({ where: { tableId, OR: references(table.fields) } });
      if (referenced || file.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
    }
    return file;
  }
  private project(record: CollabRecord, fields: CollabField[]) {
    const values: ObjectValue = {};
    const original = object(record.values);
    const system: ObjectValue = {
      CREATED_BY: record.createdBy,
      UPDATED_BY: record.updatedBy,
      CREATED_AT: record.createdAt.toISOString(),
      UPDATED_AT: record.updatedAt.toISOString(),
    };
    for (const f of fields) {
      if (object(f.options).worksheetMasked) { values[f.id]='******'; continue; }
      values[f.id] = Object.hasOwn(system, f.type) ? system[f.type] : (object(f.options).hrAge ? (canReadHrPrivate(this.actor) ? hrAge(fields,original) : null) : presentHrValue(this.actor,f,original[f.id] ?? null));
    }
    const link = fields.find((f) => !object(f.options).worksheetMasked && lifecycleKey(f) === 'upstreamId');
    return {
      ...record,
      values,
      ...(typeof original._lifecycleWritable === 'boolean' ? { writable: original._lifecycleWritable } : {}),
      ...(link && original._lifecycleLabel
        ? {
            displayValues: { [link.id]: String(original._lifecycleLabel) },
            lifecycle: {
              caseId: String(original._lifecycleCaseId),
              caseNo: original._lifecycleCaseNo ? String(original._lifecycleCaseNo) : '',
              contractId: original._lifecycleContractId ? String(original._lifecycleContractId) : null,
            },
          }
        : {}),
    };
  }
  private async businessReferences(table: CollabTable, access: Access, field: CollabField, tx: Tx,
    ids?: string[], keyword = '', limit?: number) {
    if (ids && !ids.length) return [];
    const source = choice(object(field.options).targetSource, ['LEADS', 'CHANNELS']);
    const labelKeys = source === 'LEADS' ? ['leadNo', 'name'] : ['code', 'name'];
    const columns = businessFields(source).filter(f => labelKeys.includes(String(f.options.businessKey)))
      .map((f): CollabField => ({...f, id: String(f.options.businessKey), tableId: table.id, archived: false, defaultValue: null}));
    const adapter = new WorkspaceBusinessTable(this.db, this.actor);
    adapter.authorize(source);
    const sql = await adapter.sourceSql({...table, source}, access, columns);
    return tx.$queryRaw<Array<{id:string;label:string}>>(Prisma.sql`
      SELECT r.id, concat_ws(' · ', r.values->>${labelKeys[0]}, r.values->>'name') AS label
      FROM (${sql}) r WHERE ${ids ? Prisma.sql`r.id IN (${Prisma.join(ids)})` : Prisma.sql`TRUE`}
      AND ${keyword ? Prisma.sql`concat_ws(' ', r.values->>${labelKeys[0]}, r.values->>'name') ILIKE ${'%'+keyword+'%'}` : Prisma.sql`TRUE`}
      ORDER BY r."createdAt" DESC, r.id ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`);
  }
  async businessRelationOptions(tableId: string, fieldId: string, raw: unknown) {
    const input = exact(raw, ['keyword', 'selectedIds']);
    const {table, access, fields} = await this.tableAccess(tableId);
    const field = fieldOf(fields, fieldId);
    if (field.type !== 'RELATION' || !object(field.options).targetSource) fail('COLLAB_INVALID_VALUE');
    const keyword = input.keyword ? text(input.keyword,100) : '';
    const rows = await this.businessReferences(table,access,field,this.db,undefined,keyword,101);
    const selected = await this.businessReferences(table,access,field,this.db,strings(input.selectedIds ?? [],100));
    return {options: [...new Map([...selected,...rows.slice(0,100)].map(r=>[r.id,r])).values()],hasMore:rows.length>100};
  }
  private async projectReferences(records: CollabRecord[], fields: CollabField[], access:Access) {
    const projected = records.map((record) => this.project(record, fields));
    for (const field of fields.filter((f) => f.type === 'RELATION' && !object(f.options).worksheetMasked)) {
      const business = Boolean(object(field.options).targetSource);
      const targetId = business ? field.tableId : text(object(field.options).targetTableId);
      const ids = [
        ...new Set(
          projected.flatMap((r) =>
            Array.isArray(r.values[field.id]) ? (r.values[field.id] as string[]) : [],
          ),
        ),
      ];
      let permitted = new Set<string>();
      try {
        const { table, access } = await this.tableAccess(targetId);
        if (business) {
          const targets = await this.businessReferences(table, access, field, this.db, ids);
          permitted = new Set(targets.map(r=>r.id));
          const labels = new Map(targets.map(r=>[r.id,r.label]));
          for (const record of projected) {
            const value = Array.isArray(record.values[field.id]) ? record.values[field.id] as string[] : [];
            Object.assign(record, {displayValues: {...(record as {displayValues?:Record<string,string>}).displayValues,
              [field.id]: value.filter(id=>permitted.has(id)).map(id=>labels.get(id)).join('、')}});
          }
        } else permitted = new Set(
          (
            await this.db.collabRecord.findMany({
              where: { ...this.rowWhere(targetId, access), id: { in: ids } },
              select: { id: true },
            })
          ).map((r) => r.id),
        );
      } catch (e) {
        if (!['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((e as Error).message)) throw e;
      }
      for (const record of projected)
        record.values[field.id] = (
          Array.isArray(record.values[field.id]) ? (record.values[field.id] as string[]) : []
        ).filter((id) => permitted.has(id));
    }
    for (const rec of projected) {
      const row=rec as typeof rec & {readonlyFields?:string[];displayValues?:Record<string,string>};
      const medicalLink=fields.find(f=>object(f.options).medicalRelation);
      if(medicalLink&&row.values[medicalLink.id])row.readonlyFields=[...(row.readonlyFields??[]),...fields.filter(f=>object(f.options).medicalAutofill).map(f=>f.id)];
      for (const f of fields) {
        const mode = recordFieldLevel(access,row.id,f.id);
        if (mode<3) row.readonlyFields=[...new Set([...(row.readonlyFields||[]),f.id])];
        if (mode<2 || access.masked?.includes(f.id)) {
          if (row.displayValues) delete row.displayValues[f.id];
          if (lifecycleKey(f)==='upstreamId') delete row.lifecycle;
          if (mode===0) delete row.values[f.id]; else row.values[f.id]='******';
        }
      }
      if (medicalLink && row.values[medicalLink.id] && recordFieldLevel(access,row.id,medicalLink.id)>=2 && !access.masked?.includes(medicalLink.id)) {
        const name=fields.find(f=>object(f.options).medicalAutofill==='customerName');
        const label=name && recordFieldLevel(access,row.id,name.id)>=2 && !access.masked?.includes(name.id) ? row.values[name.id] : null;
        row.displayValues={...row.displayValues,[medicalLink.id]:label?String(label):'已关联客户'};
      }
    }
    return projected;
  }
  async query(tableId: string, raw: unknown) {
    const input = exact(raw, ['viewId', 'config', 'page', 'pageSize']);
    const { table, access, fields } = await this.tableAccess(tableId);
    if (access.viewIds && (!access.viewIds.length || (input.viewId && !access.viewIds.includes(text(input.viewId))))) fail('COLLAB_FORBIDDEN',403);
    const selectedView = input.viewId || access.viewIds?.[0];
    const view = selectedView
      ? await this.db.collabView.findFirst({
          where: { id: text(selectedView), tableId, OR: [{ shared: true }, { ownerId: this.actor.userId }] },
        })
      : null;
    if (selectedView && !view) fail('COLLAB_NOT_FOUND', 404);
    const config = validateView(input.config ?? this.sanitizeConfig(view?.config ?? {},fields), fields);
    const page = integer(input.page ?? 1, 1, 100000);
    const pageSize = integer(input.pageSize ?? 50, 1, 200);
    if (table.source !== 'CUSTOM') {
      const result = await new WorkspaceBusinessTable(this.db, this.actor).query(
        table,
        access,
        fields,
        config,
        page,
        pageSize,
      );
      return { ...result, records: await this.projectReferences(result.records, fields, access) };
    }
    const rowScope = access.rowIds ? Prisma.sql`r.id=ANY(${access.rowIds}::text[])` : Prisma.sql`TRUE`;
    const where = Prisma.sql`${rowScope} AND r."tableId" = ${tableId} AND r.archived = false AND ${access.selfOnly ? Prisma.sql`r."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`} AND ${filterSql(config.filter, fields, this.actor.userId, this.actor.employeeId)}`;
    const projection = hasInventoryProjection(table.inventoryKind) ? await inventorySummarySql(this.db, table, fields, this.actor.userId, id => this.tableAccess(id)) : table.lifecycleKind ? await this.lifecycle().sourceSql(table, access, fields) : undefined;
    const result = await queryCustomRecords(this.db, isInventorySummary(table.inventoryKind) ? Prisma.sql`${rowScope} AND r."tableId"=${tableId} AND r.archived=false AND ${filterSql(config.filter, fields, this.actor.userId, this.actor.employeeId)}` : where, config, fields, page, pageSize, projection);
    if (table.lifecycleKind) await this.lifecycle().auditPhone(fields,result.records.length);
    if (isHrKind(table.inventoryKind) && result.records.length && fields.some(hrPrivate)) await this.db.operationLog.create({data:{userId:this.actor.userId,action:'HR_SENSITIVE_READ',targetType:'COLLAB_TABLE',targetId:tableId,newValues:JSON.stringify({count:result.records.length,fields:fields.filter(hrPrivate).map(f=>f.id)})}});
    return {
      ...result,
      records: await this.projectReferences(result.records, fields, access),
      page,
      pageSize,
      schemaVersion: table.schemaVersion,
    };
  }

  async record(tableId: string, recordId: string) {
    const { table, access, fields } = await this.tableAccess(tableId);
    if (table.source !== 'CUSTOM') {
      const result = await new WorkspaceBusinessTable(this.db, this.actor).query(
        table,
        access,
        fields,
        {},
        1,
        1,
        recordId,
      );
      if (!result.records.length) fail('COLLAB_NOT_FOUND', 404);
      const revisions = await this.db.collabExtensionRevision.findMany({
        where: { tableId, recordId },
        orderBy: { version: 'desc' },
        take: 50,
      });
      return {
        record: (await this.projectReferences(result.records, fields, access))[0],
        revisions: revisions.map((r) => ({
          ...r,
          changes: Object.fromEntries(
            Object.entries(object(r.changes)).filter(([id]) =>
              fields.some((f) => f.id === id && recordFieldLevel(access,recordId,id)>=2 && !object(f.options).worksheetMasked && !['FILE', 'RELATION'].includes(f.type)),
            ),
          ),
        })),
        comments: [] as never[],
      };
    }
    const record = await this.db.collabRecord.findFirst({
      where: { ...this.rowWhere(tableId, isInventorySummary(table.inventoryKind) ? {...access,selfOnly:false} : access), id: recordId },
    });
    if (!record) fail('COLLAB_NOT_FOUND', 404);
    if (hasInventoryProjection(table.inventoryKind)) {
      const source = await inventorySummarySql(this.db, table, fields, this.actor.userId, id => this.tableAccess(id));
      const [projected] = await this.db.$queryRaw<CollabRecord[]>(Prisma.sql`SELECT r.* FROM (${source}) r WHERE r.id=${recordId}`);
      record.values = projected.values;
    }
    if (table.lifecycleKind) {
      const projected = await this.db.$queryRaw<CollabRecord[]>(Prisma.sql`SELECT r.* FROM (${await this.lifecycle().sourceSql(table, access, fields)}) r WHERE r.id = ${recordId}`);
      if (!projected.length) fail('COLLAB_NOT_FOUND', 404);
      record.values = projected[0].values;
      await this.lifecycle().auditPhone(fields,1);
    }
    if (isHrKind(table.inventoryKind) && fields.some(hrPrivate)) await this.db.operationLog.create({data:{userId:this.actor.userId,action:'HR_SENSITIVE_READ',targetType:'COLLAB_RECORD',targetId:recordId}});
    const revisions = await this.db.collabRevision.findMany({
      where: { recordId },
      orderBy: { version: 'desc' },
      take: 50,
    });
    const comments = await this.db.collabComment.findMany({
      where: { tableId, recordId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return {
      record: (await this.projectReferences([record], fields, access))[0],
      revisions: revisions.map((r) => ({
        ...r,
        changes: Object.fromEntries(
          Object.entries(object(r.changes)).filter(([id]) =>
            fields.some((f) => f.id === id && recordFieldLevel(access,recordId,id)>=2 && !object(f.options).worksheetMasked && !['FILE', 'RELATION'].includes(f.type)),
          ).map(([id,change])=>{ const f=fields.find(f=>f.id===id)!; const c=object(change); return [id,{before:presentHrValue(this.actor,f,c.before),after:presentHrValue(this.actor,f,c.after)}]; }),
        ),
      })),
      comments,
    };
  }
  private async businessLead(tableId: string, recordId: string, tx: Tx = this.db, level = 1) {
    const result = await this.tableAccess(tableId, tx, level);
    if (result.access.rowIds && !result.access.rowIds.includes(recordId)) fail('COLLAB_NOT_FOUND',404);
    if (result.table.source !== 'LEADS') fail('COLLAB_INVALID_SOURCE');
    const lead = await tx.lead.findFirst({
      where: {
        AND: [
          await new WorkspaceBusinessTable(this.db, this.actor).scope(result.access),
          { id: recordId },
          ...(result.access.selfOnly ? [{ createdBy: this.actor.userId }] : []),
        ],
      },
    });
    if (!lead) fail('COLLAB_NOT_FOUND', 404);
    return { ...result, lead };
  }
  private async businessCapabilities(tableId: string, recordId: string, tx: Tx = this.db) {
    const result = await this.businessLead(tableId, recordId, tx);
    const { lead, access, fields } = result;
    const permitted = async (code: 'lead.update' | 'lead.assign' | 'lead.pool.claim' | 'lead.recycle') =>
      access.level >= 2 &&
      this.actor.permissionCodes.includes(code) &&
      !!(await tx.lead.findFirst({
        where: {
          AND: [
            { id: lead.id },
            await buildLeadScopeWhere(
              this.db,
              new AuthorizationService(new DataScopeService(this.db)),
              this.actor,
              code,
            ),
          ],
        },
        select: { id: true },
      }));
    const writable = (key: string) =>
      fields.some((f) => object(f.options).businessKey === key && !access.readonly.includes(f.id));
    const update = await permitted('lead.update');
    const assign = await permitted('lead.assign');
    const stateWritable = writable('status');
    const poolWritable = writable('assignedTo') && writable('poolStatus');
    const activeEmployee = this.actor.employeeId
      ? await tx.employee.findFirst({
          where: { id: this.actor.employeeId, status: { not: 'LEAVED' }, deletedAt: null },
          select: { id: true },
        })
      : null;
    const poolPermissions = {
      claim:
        !!activeEmployee &&
        poolWritable &&
        (lead.status !== 'NEW' || stateWritable) &&
        (await permitted('lead.pool.claim')),
      recycle: poolWritable && (await permitted('lead.recycle')),
    };
    return {
      ...result,
      poolPermissions,
      capabilities: {
        claim: lead.poolStatus !== 'PRIVATE' && poolPermissions.claim,
        recycle: lead.poolStatus === 'PRIVATE' && poolPermissions.recycle,
        follow: update && (lead.status !== 'ASSIGNED' || stateWritable),
        status: update && stateWritable,
        assign:
          assign &&
          writable('assignedTo') &&
          writable('poolStatus') &&
          (lead.status !== 'NEW' || stateWritable),
      },
    };
  }
  async businessDetail(tableId: string, recordId: string, raw: unknown = {}) {
    const input = exact(raw, ['page']);
    const page = integer(input.page ?? 1, 1, 100000);
    const { lead, access, capabilities } = await this.businessCapabilities(tableId, recordId);
    const followWhere: Prisma.LeadFollowWhereInput = { deletedAt: null, leadId: lead.id, ...(access.selfOnly ? { createdBy: this.actor.userId } : {}) };
    const logWhere = {
      targetType: 'LEAD',
      targetId: lead.id,
      action: {
        in: [
          'LEAD_FOLLOW_CREATE',
          'LEAD_UPDATE',
          'LEAD_DELETE',
          'LEAD_FOLLOW_UPDATE',
          'LEAD_FOLLOW_DELETE',
          'LEAD_STATUS_TRANSITION',
          'LEAD_ASSIGN',
          'LEAD_REASSIGN',
          'LEAD_POOL_CLAIM',
          'LEAD_POOL_RECYCLE',
          'LEAD_RECYCLE',
        ],
      },
      ...(access.selfOnly ? { userId: this.actor.userId } : {}),
    };
    const [follows, followsTotal, history, historyTotal] = await this.db.$transaction(
      [
        this.db.leadFollow.findMany({
          where: followWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        this.db.leadFollow.count({ where: followWhere }),
        this.db.operationLog.findMany({
          where: logWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * 20,
          take: 20,
          select: { id: true, userId: true, action: true, createdAt: true },
        }),
        this.db.operationLog.count({ where: logWhere }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const statuses = LEAD_STATUS.filter(
      (status) =>
        status !== 'CONVERTED' &&
        status !== 'ASSIGNED' &&
        (REACTIVATE_ENABLED || (status !== 'NURTURE' && lead.status !== 'NURTURE')) &&
        canTransition(lead.status as LeadStatus, status),
    );
    const directory = capabilities.assign ? await this.options(access.workspaceId) : null;
    return {
      version: lead.version,
      capabilities,
      statuses: capabilities.status ? statuses : [],
      assignees: directory?.employees ?? [],
      follows,
      followsTotal,
      history,
      historyTotal,
      page,
    };
  }
  async businessAction(tableId: string, recordId: string, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'action',
      'version',
      'type',
      'content',
      'nextPlan',
      'nextTime',
      'status',
      'employeeId',
      'reason',
    ]);
    const action = choice(input.action, ['FOLLOW', 'STATUS', 'ASSIGN', 'CLAIM', 'RECYCLE']);
    // Reject unrelated fields so a retry fingerprint always describes exactly one command.
    exact(
      input,
      action === 'FOLLOW'
        ? ['action', 'version', 'type', 'content', 'nextPlan', 'nextTime']
        : action === 'STATUS'
          ? ['action', 'version', 'status', 'reason']
          : action === 'ASSIGN'
            ? ['action', 'version', 'employeeId', 'reason']
            : action === 'RECYCLE'
              ? ['action', 'version', 'reason']
              : ['action', 'version'],
    );
    const initial = await this.businessCapabilities(tableId, recordId);
    const capability =
      action === 'FOLLOW'
        ? 'follow'
        : action === 'STATUS'
          ? 'status'
          : action === 'ASSIGN'
            ? 'assign'
            : action === 'CLAIM'
              ? 'claim'
              : 'recycle';
    if (
      !initial.capabilities[capability] &&
      !((capability === 'claim' || capability === 'recycle') && initial.poolPermissions[capability])
    )
      fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['business.action', tableId, recordId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM lead WHERE id = ${recordId} FOR UPDATE`);
      const current = await this.businessCapabilities(tableId, recordId, tx);
      await this.checkRowWrite(current.table,current.access,tx,recordId,[],'edit');
      if (!current.capabilities[capability]) fail('COLLAB_FORBIDDEN', 403);
      if (current.lead.version !== integer(input.version)) fail('COLLAB_RECORD_CONFLICT', 409);
      const actor = { actorUserId: this.actor.userId };
      if (action === 'FOLLOW') {
        const nextTime = input.nextTime ? new Date(text(input.nextTime)) : undefined;
        if (nextTime && !Number.isFinite(nextTime.getTime())) fail('COLLAB_INVALID_DATE');
        await new LeadFollowService(this.db, actor, this.actor).recordFollow(
          recordId,
          {
            type: choice(input.type, LEAD_FOLLOW_TYPES),
            content: text(input.content, 2000),
            nextPlan: input.nextPlan ? text(input.nextPlan, 500) : undefined,
            nextTime,
          },
          tx,
        );
      } else if (action === 'STATUS') {
        const status = choice(input.status, LEAD_STATUS);
        if (status === 'CONVERTED' || status === 'ASSIGNED') fail('COLLAB_USE_BUSINESS_ACTION', 409);
        await new LeadService(this.db, actor, this.actor).transitionStatus(
          recordId,
          status,
          text(input.reason, 500),
          tx,
        );
      } else if (action === 'CLAIM') {
        await new LeadAssignmentService(this.db, actor, this.actor).claimFromPool(recordId, tx);
      } else if (action === 'RECYCLE') {
        await new LeadAssignmentService(this.db, actor, this.actor).recycle(
          recordId,
          text(input.reason, 500),
          tx,
        );
      } else {
        const employeeId = text(input.employeeId);
        const root = await tx.organization.findUniqueOrThrow({
          where: { id: current.access.organizationId },
        });
        const now = new Date();
        const target = await tx.employee.findFirst({
          where: {
            id: employeeId,
            status: { not: 'LEAVED' },
            deletedAt: null,
            assignments: {
              some: {
                startedAt: { lte: now },
                OR: [{ endedAt: null }, { endedAt: { gt: now } }],
                position: { status: 'ENABLED' },
                organization: {
                  status: 'ENABLED',
                  OR: [{ id: root.id }, { path: { startsWith: root.path.replace(/\/$/, '') + '/' } }],
                },
              },
            },
          },
          select: { id: true },
        });
        if (!target) fail('COLLAB_MEMBER_UNAVAILABLE');
        await new LeadAssignmentService(this.db, actor, this.actor).assign(
          recordId,
          target.id,
          text(input.reason, 500),
          tx,
        );
      }
      const bases = await tx.collabBase.findMany({ where: { workspaceId: current.access.workspaceId } });
      for (const base of bases) await this.event(tx, base.id, 'business.changed', recordId);
      return {
        id: recordId,
        version: (await tx.lead.findUniqueOrThrow({ where: { id: recordId } })).version,
      };
    });
  }
  private async values(
    tx: Tx,
    tableId: string,
    fields: CollabField[],
    access: Access,
    input: unknown,
    existing: ObjectValue = {},
    creating = false,
  ): Promise<ObjectValue> {
    const patch = object(input);
    const result = { ...existing };
    for (const [id, value] of Object.entries(patch)) {
      const field = fieldOf(fields, id);
      if (access.readonly.includes(id) || isSystemField(field) || syncedLifecycleKeys.includes(lifecycleKey(field)))
        fail('COLLAB_READONLY_FIELD', 403, { fieldId: id });
      try {
        result[id] = validateValue(field, value);
      } catch (error) {
        if (error instanceof Error) fail(error.message, 422, { fieldId: id });
        throw error;
      }
    }
    for (const field of fields.filter((f) => !isSystemField(f))) {
      try {
        if (creating && result[field.id] === undefined && object(field.options).defaultNow)
          result[field.id] = new Date().toISOString();
        if (creating && result[field.id] === undefined && field.defaultValue !== null)
          result[field.id] = validateValue(field, field.defaultValue);
        if (field.required) validateValue(field, result[field.id]);
      } catch (error) {
        if (error instanceof CollaborationError) fail(error.code, error.status, { fieldId: field.id });
        throw error;
      }
      const value = result[field.id];
      if (value === null || value === undefined) continue;
      if (field.type === 'USER') {
        const person = await tx.employee.findFirst({
          where: {
            id: String(value),
            deletedAt: null,
            status: { not: 'LEAVED' },
            assignments: {
              some: {
                endedAt: null,
                organization: {
                  OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }],
                },
              },
            },
          },
        });
        if (!person) fail('COLLAB_MEMBER_UNAVAILABLE', 422, { fieldId: field.id });
      }
      if (field.type === 'ORGANIZATION') {
        const org = await tx.organization.findFirst({
          where: {
            id: String(value),
            status: 'ENABLED',
            OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }],
          },
        });
        if (!org) fail('COLLAB_ORGANIZATION_UNAVAILABLE');
      }
      if (field.type === 'FILE' && Array.isArray(value)) {
        if (creating || Object.prototype.hasOwnProperty.call(patch, field.id))
          for (const id of value) await this.attachment(tableId, String(id), tx);
      }
      if (field.type === 'RELATION' && Array.isArray(value)) {
        if (object(field.options).targetSource) {
          const table = await tx.collabTable.findUniqueOrThrow({where:{id:tableId}});
          const targets = await this.businessReferences(table,access,field,tx,value as string[]);
          if (targets.length !== value.length) fail('COLLAB_RELATION_UNAVAILABLE',422,{fieldId:field.id});
          continue;
        }
        const target = text(object(field.options).targetTableId);
        const a = await this.tableAccess(target, tx);
        const count = await tx.collabRecord.count({
          where: { ...this.rowWhere(target, a.access), id: { in: value as string[] } },
        });
        if (count !== value.length) fail('COLLAB_RELATION_UNAVAILABLE');
      }
    }
    return result;
  }
  private async extensionTarget(
    table: { id: string; source: string },
    access: Access,
    recordId: string,
    tx: Tx,
    permission: 'lead.update' | 'lead.delete' | 'lead.follow.delete' = 'lead.update',
  ) {
    if (isDomainSource(table.source))
      return new WorkspaceDomainSource(this.db, this.actor).target(table.source, access, recordId, tx);
    if (!this.actor.permissionCodes.includes(permission)) fail('COLLAB_FORBIDDEN', 403);
    const adapter = new WorkspaceBusinessTable(this.db, this.actor);
    const scope: Prisma.LeadWhereInput = {
      AND: [
        await adapter.scope(access),
        await buildLeadScopeWhere(
          this.db,
          new AuthorizationService(new DataScopeService(this.db)),
          this.actor,
          permission,
        ),
      ],
    };
    const own = access.selfOnly ? { createdBy: this.actor.userId } : {};
    if (table.source === 'LEADS') {
      const row = await tx.lead.findFirst({ where: { AND: [scope, { id: recordId, ...own }] } });
      if (!row) fail('COLLAB_NOT_FOUND', 404);
      return { version: row.version };
    }
    const row = await tx.leadFollow.findFirst({ where: { id: recordId, deletedAt: null, ...own, lead: scope } });
    if (!row) fail('COLLAB_NOT_FOUND', 404);
    return { version: row.version };
  }
  private async saveExtension(
    tableId: string,
    recordId: string | undefined,
    input: ObjectValue,
    key: unknown,
    transaction?: Tx,
  ) {
    if (!recordId || input.archived !== undefined || !Object.keys(object(input.values ?? {})).length)
      fail('COLLAB_USE_BUSINESS_ACTION', 409);
    const initial = await this.tableAccess(tableId, transaction ?? this.db, 2);
    await this.extensionTarget(initial.table, initial.access, recordId, transaction ?? this.db);
    return this.write(
      key,
      ['extension.save', tableId, recordId, input],
      async (tx) => {
        await this.lock(tx, initial.access.workspaceId, true);
        const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
        if (table.schemaVersion !== integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT', 409);
        await tx.$queryRaw(
          isDomainSource(table.source)
            ? Prisma.sql`SELECT id FROM ${Prisma.raw(domainSources[table.source].table)} WHERE id = ${recordId} FOR UPDATE`
            : table.source === 'LEADS'
              ? Prisma.sql`SELECT id FROM lead WHERE id = ${recordId} FOR UPDATE`
              : Prisma.sql`SELECT id FROM lead_follow WHERE id = ${recordId} FOR UPDATE`,
        );
        const core = await this.extensionTarget(table, access, recordId, tx);
        const previous = await tx.collabExtension.findUnique({
          where: { tableId_recordId: { tableId, recordId } },
        });
        const version = core.version + (previous?.version ?? 0);
        if (version !== integer(input.version)) fail('COLLAB_RECORD_CONFLICT', 409);
        if (
          Object.keys(object(input.values)).some((id) =>
            fields.some((f) => f.id === id && object(f.options).businessKey),
          )
        )
          fail('COLLAB_USE_BUSINESS_ACTION', 409);
        const extensions = fields.filter((f) => !object(f.options).businessKey);
        const next = await this.values(
          tx,
          tableId,
          extensions,
          access,
          input.values,
          previous ? hrValues(table.fields,previous.values,false) : {},
          !previous,
        );
        if (
          table.fields.some(
            (f) =>
              !f.archived &&
              !object(f.options).businessKey &&
              f.required &&
              !extensions.some((v) => v.id === f.id) &&
              (next[f.id] === undefined || next[f.id] === null || next[f.id] === ''),
          )
        )
          fail('COLLAB_REQUIRED_FIELD_FORBIDDEN', 403);
        const row = await tx.collabExtension.upsert({
          where: { tableId_recordId: { tableId, recordId } },
          create: { tableId, recordId, values: json(next), updatedBy: this.actor.userId },
          update: { values: json(next), updatedBy: this.actor.userId, version: { increment: 1 } },
        });
        const changes = Object.fromEntries(
          Object.keys(next)
            .filter(
              (id) =>
                JSON.stringify(previous ? object(previous.values)[id] : null) !== JSON.stringify(next[id]),
            )
            .map((id) => [
              id,
              { before: previous ? (object(previous.values)[id] ?? null) : null, after: next[id] },
            ]),
        );
        await tx.collabExtensionRevision.create({
          data: {
            tableId,
            recordId,
            version: row.version,
            actorId: this.actor.userId,
            changes: json(changes),
          },
        });
        if (table.source === 'CUSTOMERS') await syncCustomerSource(tx, recordId, this.actor.userId, tableId);
        await this.event(tx, table.baseId, 'record.updated', recordId);
        return { id: recordId, version: core.version + row.version };
      },
      transaction,
    );
  }
  /** One transaction owns mutation, audit, recovery payload and idempotency result. */
  async saveRecord(
    tableId: string,
    recordId: string | undefined,
    raw: unknown,
    key: unknown,
    transaction?: Tx,
  ) {
    await this.tableAccess(tableId, transaction ?? this.db, 2);
    return this.write(
      key,
      ['record.command', tableId, recordId, raw],
      async (tx) => {
        const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
        const input = object(raw);
        let before: ObjectValue = {};
        const medicalLink=table.followSupportKind==='MEDICAL_ASSESSMENT'&&fields.find(f=>object(f.options).medicalRelation);
        const changedFields=[...new Set([...Object.keys(object(input.values??{})),
          ...(medicalLink&&Object.hasOwn(object(input.values??{}),medicalLink.id)?fields.filter(f=>object(f.options).medicalAutofill).map(f=>f.id):[])])];
        if (recordId) {
          const rows =
            table.source === 'CUSTOM'
              ? await tx.collabRecord.findMany({ where: { ...this.rowWhere(tableId, access), id: recordId } })
              : await tx.$queryRaw<CollabRecord[]>(
                  Prisma.sql`SELECT r.* FROM (${await new WorkspaceBusinessTable(this.db, this.actor).sourceSql(table, access, fields)}) r WHERE r.id = ${recordId}`,
                );
          if (!rows.length) fail('COLLAB_NOT_FOUND', 404);
          before = Object.fromEntries(
            changedFields.map((id) => [id, object(rows[0].values)[id] ?? null]),
          );
        }
        if (!recordId && access.add === false) fail('COLLAB_FORBIDDEN',403);
        if (recordId) await this.checkRowWrite(table,access,tx,recordId,changedFields,input.archived === true ? 'remove' : 'edit');
        const saved = await this.mutateRecord(tableId, recordId, raw, key, tx);
        if (input.archived !== true) await this.checkRowWrite(table,access,tx,saved.id,changedFields,recordId ? 'edit' : 'add');
        // Retain only field deltas, never expose private recovery payloads in history endpoints.
        const predecessor = recordId
          ? await tx.collabRecordOperation.findFirst({
              where: {
                tableId,
                recordId,
                actorId: this.actor.userId,
                undone: false,
                expectedVersion: Number(input.version),
              },
              orderBy: { createdAt: 'desc' },
            })
          : null;
        const savedValues=medicalLink ? (await tx.collabRecord.findUniqueOrThrow({where:{id:saved.id}})).values : null;
        const afterValues=savedValues ? Object.fromEntries(changedFields.map(id=>[id,object(savedValues)[id]??null])) : input.values??{};
        const operation = await tx.collabRecordOperation.create({
          data: {
            tableId,
            recordId: saved.id,
            actorId: this.actor.userId,
            kind: input.archived === true ? 'DELETE' : recordId ? 'UPDATE' : 'CREATE',
            before: json(before),
            after: json({ values: hrValues(fields,afterValues,true), predecessorId: predecessor?.id ?? null }),
            expectedVersion: saved.version,
            schemaVersion: table.schemaVersion,
          },
        });
        return { ...saved, operationId: operation.id };
      },
      transaction,
    );
  }
  async importRecords(tableId:string,raw:unknown,key:string) {
    const input=exact(raw,['records','schemaVersion']);
    if(!Array.isArray(input.records)||!input.records.length||input.records.length>200) fail('COLLAB_INVALID_INPUT');
    return this.write(key,['records.import',tableId,input],async tx=>{
      const {table,access}=await this.tableAccess(tableId,tx,2);
      if(!this.actor.isSystemSuperAdmin && access.import!==true) fail('COLLAB_FORBIDDEN',403);
      if(table.source!=='CUSTOM'||table.lifecycleKind||hasInventoryProjection(table.inventoryKind)) fail('COLLAB_IMPORT_UNSUPPORTED',422);
      if(table.schemaVersion!==integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT',409);
      const ids:string[]=[];
      for(const values of input.records as unknown[])
        ids.push((await this.saveRecord(tableId,undefined,{values,schemaVersion:table.schemaVersion},key,tx)).id);
      return {ids,count:ids.length};
    });
  }
  async exportRecords(tableId:string,raw:unknown) {
    const input=exact(raw,['viewId','config']);
    if(!this.actor.isSystemSuperAdmin&&!this.actor.permissionCodes.includes('data.bulk_export')) fail('COLLAB_FORBIDDEN',403);
    return this.db.$transaction(async tx=>{
      const service=new CollaborationService(tx as PrismaClient,this.actor,this.preview);
      const detail=await service.describe(tableId);
      if(detail.access.copy===false) fail('COLLAB_FORBIDDEN',403);
      const rows:Awaited<ReturnType<CollaborationService['query']>>['records']=[];
      for(let page=1;page<=50;page++) {
        const result=await service.query(tableId,{...input,page,pageSize:200});
        if(result.total>10000) fail('COLLAB_EXPORT_LIMIT',422);
        rows.push(...result.records);
        if(rows.length>=result.total)break;
      }
      const caps=tableBusinessCapabilities(detail.table);
      const projection=new FieldProjectionService();
      const fields=detail.fields.filter(f=>{
        const policy=FIELD_CATALOG.find(p=>p.resource===caps.resource && p.field===object(f.options).businessKey);
        return !policy || projection.canExportField(this.actor,policy.resource,policy.code,(caps.basic.find(p=>p.endsWith('.read'))||'lead.read') as never);
      });
      return {fields:fields.map(f=>({id:f.id,name:f.name})),records:rows.map(r=>({id:r.id,values:Object.fromEntries(fields.map(f=>[f.id,r.values[f.id]]))}))};
    },{isolationLevel:'RepeatableRead',timeout:30000});
  }

  async recordOperations(tableId: string, raw: unknown = {}) {
    const input = exact(raw, ['trash', 'page']);
    await this.tableAccess(tableId, this.db, 2);
    if (input.trash === 'true') {
      const page = input.page === undefined ? 1 : integer(Number(input.page));
      if (page < 1 || page > 100000) fail('COLLAB_INVALID_VALUE');
      const where = {
        tableId,
        actorId: this.actor.userId,
        OR: [
          { kind: 'DELETE', undone: false },
          { kind: 'CREATE', undone: true },
        ],
      };
      const [rows, total] = await this.db.$transaction([
        this.db.collabRecordOperation.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * 20,
          take: 20,
          select: { id: true, recordId: true, kind: true, undone: true, createdAt: true },
        }),
        this.db.collabRecordOperation.count({ where }),
      ]);
      return { rows, total, page };
    }
    return this.db.collabRecordOperation.findMany({
      where: { tableId, actorId: this.actor.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { id: true, recordId: true, kind: true, undone: true, createdAt: true },
    });
  }
  async deleteRecords(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['schemaVersion', 'records']);
    if (!Array.isArray(input.records) || !input.records.length || input.records.length > 100)
      fail('COLLAB_BATCH_LIMIT');
    await this.tableAccess(tableId, this.db, 2);
    return this.write(key, ['records.delete', tableId, raw], async (tx) => {
      const results = [];
      for (const row of input.records as unknown[]) {
        const item = exact(row, ['id', 'version']);
        results.push(
          await this.saveRecord(
            tableId,
            text(item.id),
            { archived: true, version: integer(item.version), schemaVersion: integer(input.schemaVersion) },
            key,
            tx,
          ),
        );
      }
      return { records: results };
    });
  }
  async reverseRecordOperation(tableId: string, operationId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['direction']);
    const direction = choice(input.direction, ['undo', 'redo']);
    const initial = await this.tableAccess(tableId, this.db, 2);
    return this.write(key, ['record.reverse', tableId, operationId, direction], async (tx) => {
      await this.lock(tx, initial.access.workspaceId, true);
      if (['OFFICE_STOCK', 'ADMIN_MEETINGS', ...caseArchiveKinds].includes(initial.table.inventoryKind || '')) await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${tableId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM collab_record_operation WHERE id = ${operationId} FOR UPDATE`;
      const operation = await tx.collabRecordOperation.findFirst({
        where: { id: operationId, tableId, actorId: this.actor.userId },
      });
      if (!operation || operation.undone !== (direction === 'redo')) fail('COLLAB_RECORD_CONFLICT', 409);
      const { table, access } = await this.tableAccess(tableId, tx, 2);
      const deleting =
        operation.kind === 'CREATE'
          ? direction === 'undo'
          : operation.kind === 'DELETE' && direction === 'redo';
      const restoring =
        operation.kind === 'DELETE'
          ? direction === 'undo'
          : operation.kind === 'CREATE' && direction === 'redo';
      if (deleting) await this.checkRowWrite(table,access,tx,operation.recordId,[],'remove');
      if (restoring && access.add === false) fail('COLLAB_FORBIDDEN',403);
      if (!restoring && table.schemaVersion !== operation.schemaVersion) fail('COLLAB_SCHEMA_CONFLICT', 409);
      let version: number;
      if (restoring) {
        // Keep the canonical row and all dependent material. Restore only this tombstone,
        // then re-check current business/table/row permissions before the transaction commits.
        if (table.source === 'CUSTOM') {
          await tx.$queryRaw`SELECT id FROM collab_record WHERE id = ${operation.recordId} FOR UPDATE`;
          const row = await tx.collabRecord.findFirst({
            where: {
              id: operation.recordId,
              tableId,
              archived: true,
              ...(access.selfOnly ? { createdBy: this.actor.userId } : {}),
            },
          });
          if (!row || row.version !== operation.expectedVersion) fail('COLLAB_RECORD_CONFLICT', 409);
          const restoredValues = hrValues(table.fields,row.values,false);
          validateHrRecord(table.inventoryKind,table.fields,restoredValues);
          await validateOfficeStock(tx, table, table.fields, restoredValues, row.id);
          await validateAdministrativeRecord(tx, table, table.fields, restoredValues, row.id);
          await validateCaseArchiveRecord(tx, table, table.fields, restoredValues, row.id);
          for (const field of table.fields.filter((f) => !f.archived && !isSystemField(f))) {
            if (restoredValues[field.id] === undefined && field.defaultValue !== null)
              restoredValues[field.id] = field.defaultValue;
            validateValue(field, restoredValues[field.id]);
          }
          await this.values(
            tx,
            tableId,
            table.fields.filter((f) => !f.archived),
            access,
            {},
            restoredValues,
          );
          if (table.lifecycleKind) await this.lifecycle().validate(tx, table, table.fields.filter(f => !f.archived), access, restoredValues, row, false);
          version = (
            await tx.collabRecord.update({
              where: { id: row.id },
              data: {
                archived: false,
                values: json(hrValues(table.fields,restoredValues,true)),
                version: { increment: 1 },
                updatedBy: this.actor.userId,
              },
            })
          ).version;
          if(table.lifecycleKind==='CASE_REFUNDS') {
            const link=await tx.collabLifecycleLink.findUniqueOrThrow({where:{recordId:row.id}});
            await this.lifecycle().syncFinancialApplication(tx,table,{...row,values:restoredValues as Prisma.JsonObject,archived:false,version},table.fields,link.caseId);
          }
        } else if (table.source === 'PAYMENTS') {
          const extension = await tx.collabExtension.findUnique({where:{tableId_recordId:{tableId,recordId:operation.recordId}}});
          const saved = await new WorksheetFinance(this.db,this.actor).payment(tx,operation.recordId,operation.expectedVersion-(extension?.version??0),{},'restore');
          await new WorkspaceDomainSource(this.db,this.actor).target('PAYMENTS',access,operation.recordId,tx,'delete');
          version=saved.version+(extension?.version??0);
        } else {
          const sqlTable =
            table.source === 'LEADS'
              ? 'lead'
              : table.source === 'FOLLOWS'
                ? 'lead_follow'
                : isDomainSource(table.source)
                  ? domainSources[table.source].table
                  : '';
          if (
            !['LEADS', 'FOLLOWS', 'CASES', 'NEGOTIATIONS', 'CONTRACTS', 'COSTS', 'CUSTOMERS', 'CHANNELS'].includes(
              table.source,
            )
          )
            fail('COLLAB_USE_BUSINESS_ACTION', 409);
          const extension = await tx.collabExtension.findUnique({
            where: { tableId_recordId: { tableId, recordId: operation.recordId } },
          });
          const deletedCustomer =
            table.source === 'CUSTOMERS'
              ? await tx.customer.findUnique({
                  where: { id: operation.recordId },
                  select: { deletedAt: true },
                })
              : null;
          const changed = await tx.$queryRaw<Array<{ version: number }>>(
            Prisma.sql`UPDATE ${Prisma.raw(sqlTable)} SET "deletedAt" = NULL, version = version + 1, "updatedBy" = ${this.actor.userId} ${Prisma.sql`, "updatedAt" = CURRENT_TIMESTAMP`} WHERE id = ${operation.recordId} AND "deletedAt" IS NOT NULL AND version = ${operation.expectedVersion - (extension?.version ?? 0)} RETURNING version`,
          );
          if (!changed.length) fail('COLLAB_RECORD_CONFLICT', 409);
          if (table.source === 'LEADS' || table.source === 'FOLLOWS')
            await this.extensionTarget(
              table,
              access,
              operation.recordId,
              tx,
              table.source === 'LEADS' ? 'lead.delete' : 'lead.follow.delete',
            );
          else if (isDomainSource(table.source))
            await new WorkspaceDomainSource(this.db, this.actor).target(
              table.source,
              access,
              operation.recordId,
              tx,
              'delete',
            );
          if (deletedCustomer?.deletedAt)
            await tx.contact.updateMany({
              where: { customerId: operation.recordId, deletedAt: deletedCustomer.deletedAt },
              data: { deletedAt: null },
            });
          version = changed[0].version + (extension?.version ?? 0);
        }
        await this.event(tx, table.baseId, 'record.restored', operation.recordId);
      } else {
        const restoreInput={
          ...(deleting?{archived:true}:{values:hrValues(table.fields,direction==='undo'?operation.before:object(operation.after).values,false)}),
          version:operation.expectedVersion,schemaVersion:operation.schemaVersion,
        };
        const result=table.followSupportKind==='MEDICAL_ASSESSMENT'&&!deleting
          ? await this.saveRecordInTransaction(tableId,operation.recordId,restoreInput,key,tx,true)
          : await this.mutateRecord(tableId,operation.recordId,restoreInput,key,tx);
        version = result.version;
      }
      if (!deleting) await this.checkRowWrite(table,access,tx,operation.recordId,Object.keys(object(object(operation.after).values ?? {})),restoring ? 'add' : 'edit');
      await tx.collabRecordOperation.update({
        where: { id: operation.id },
        data: { undone: direction === 'undo', expectedVersion: version, schemaVersion: table.schemaVersion },
      });
      // Only rebase an explicitly continuous chain. A different actor/domain edit
      // between our commands breaks the chain and must remain a conflict.
      const predecessorId = object(operation.after).predecessorId;
      const adjacent =
        direction === 'undo'
          ? typeof predecessorId === 'string'
            ? await tx.collabRecordOperation.findFirst({
                where: { id: predecessorId, actorId: this.actor.userId, tableId, undone: false },
              })
            : null
          : await tx.collabRecordOperation.findFirst({
              where: {
                tableId,
                actorId: this.actor.userId,
                undone: true,
                after: { path: ['predecessorId'], equals: operation.id },
              },
              orderBy: { createdAt: 'asc' },
            });
      if (adjacent)
        await tx.collabRecordOperation.update({
          where: { id: adjacent.id },
          data: { expectedVersion: version },
        });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: direction === 'undo' ? 'WORKSHEET_UNDO' : 'WORKSHEET_REDO',
          targetType: 'COLLAB_RECORD',
          targetId: operation.recordId,
          newValues: JSON.stringify({ operationId, tableId, version }),
        },
      });
      return { id: operation.recordId, version };
    });
  }
  private async mutateRecord(
    tableId: string,
    recordId: string | undefined,
    raw: unknown,
    key: unknown,
    transaction?: Tx,
  ) {
    const initial = await this.tableAccess(tableId, transaction ?? this.db, 2);
    if (['PAYMENTS','REFUNDS'].includes(initial.table.source) && recordId) {
      const input=exact(raw,['values','version','schemaVersion','archived']);
      return this.write(key,['finance.record.save',tableId,recordId,input],async tx=>{
        await this.lock(tx,initial.access.workspaceId,true);
        const {table,access,fields}=await this.tableAccess(tableId,tx,2);
        if(table.schemaVersion!==integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT',409);
        const deleting=input.archived===true;
        if(input.archived!==undefined&&!deleting) fail('COLLAB_INVALID_VALUE');
        if(deleting&&table.source!=='PAYMENTS') fail('COLLAB_USE_BUSINESS_ACTION',409);
        const core=await new WorkspaceDomainSource(this.db,this.actor).target(table.source as 'PAYMENTS'|'REFUNDS',access,recordId,tx,deleting?'delete':'update');
        const extension=await tx.collabExtension.findUnique({where:{tableId_recordId:{tableId,recordId}}});
        if(integer(input.version)!==core.version+(extension?.version??0)) fail('COLLAB_RECORD_CONFLICT',409);
        const patch:Record<string,unknown>={}, extras:Record<string,unknown>={};
        for(const [id,value] of Object.entries(object(input.values??{}))) {
          const field=fields.find(f=>f.id===id);
          if(!field||access.readonly.includes(id)) fail('COLLAB_FIELD_UNAVAILABLE',403);
          const name=String(object(field.options).businessKey??'');
          if(!name) { extras[id]=value; continue; }
          if(!(table.source==='PAYMENTS'?paymentWorksheetKeys:refundExecutionKeys).includes(name)) fail('COLLAB_READONLY_FIELD',403);
          validateValue(field,value);
          if(name==='voucherFiles') for(const fileId of value as string[]) await this.attachment(tableId,fileId,tx);
          patch[name]=value;
        }
        if(deleting&&(Object.keys(patch).length||Object.keys(extras).length)) fail('COLLAB_INVALID_VALUE');
        if(!deleting&&!Object.keys(patch).length&&!Object.keys(extras).length) fail('COLLAB_INVALID_VALUE');
        const finance=new WorksheetFinance(this.db,this.actor);
        let version=core.version;
        if(deleting||Object.keys(patch).length)
          version=(table.source==='PAYMENTS'?await finance.payment(tx,recordId,core.version,patch,deleting?'delete':'edit'):await finance.refund(tx,recordId,core.version,patch)).version;
        let combined=version+(extension?.version??0);
        if(Object.keys(extras).length)
          combined=(await this.saveExtension(tableId,recordId,{values:extras,version:combined,schemaVersion:table.schemaVersion},key,tx)).version;
        await this.event(tx,table.baseId,deleting?'record.deleted':'record.updated',recordId);
        return {id:recordId,version:combined};
      },transaction);
    }
    if (initial.table.source === 'LEADS' || initial.table.source === 'FOLLOWS') {
      if (!recordId) fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const input = exact(raw, ['values', 'version', 'schemaVersion', 'archived']);
      return this.write(
        key,
        ['crm.record.save', tableId, recordId, input],
        async (tx) => {
          await this.lock(tx, initial.access.workspaceId, true);
          const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
          const source = table.source;
          if (source !== 'LEADS' && source !== 'FOLLOWS') fail('COLLAB_INVALID_SOURCE');
          if (integer(input.schemaVersion) !== table.schemaVersion) fail('COLLAB_SCHEMA_CONFLICT', 409);
          await tx.$queryRaw(
            source === 'LEADS'
              ? Prisma.sql`SELECT id FROM lead WHERE id = ${recordId} FOR UPDATE`
              : Prisma.sql`SELECT id FROM lead_follow WHERE id = ${recordId} FOR UPDATE`,
          );
          const deleting = input.archived === true;
          if (input.archived !== undefined && !deleting) fail('COLLAB_INVALID_VALUE');
          const core = await this.extensionTarget(
            table,
            access,
            recordId,
            tx,
            deleting ? (source === 'LEADS' ? 'lead.delete' : 'lead.follow.delete') : 'lead.update',
          );
          const extension = await tx.collabExtension.findUnique({
            where: { tableId_recordId: { tableId, recordId } },
          });
          if (integer(input.version) !== core.version + (extension?.version ?? 0))
            fail('COLLAB_RECORD_CONFLICT', 409);
          const patch: ObjectValue = {},
            extras: ObjectValue = {};
          const values = source === 'FOLLOWS' ? await this.values(tx,tableId,fields.filter(f=>Object.hasOwn(object(input.values??{}),f.id)),access,input.values??{}) : object(input.values ?? {});
          if (deleting && Object.keys(values).length) fail('COLLAB_INVALID_VALUE');
          for (const [id, value] of Object.entries(values)) {
            const field = fields.find((f) => f.id === id);
            if (!field || access.readonly.includes(id) || isSystemField(field))
              fail('COLLAB_FIELD_UNAVAILABLE', 403);
            const businessKey = String(object(field.options).businessKey ?? '');
            if (!businessKey) extras[id] = value;
            else {
              if (!editableCrmKey(source, businessKey, this.actor)) fail('COLLAB_USE_BUSINESS_ACTION', 409);
              patch[businessKey] = value;
            }
          }
          if (!deleting && !Object.keys(values).length) fail('COLLAB_INVALID_VALUE');
          let version = core.version;
          if (deleting || Object.keys(patch).length)
            version = (
              await new CrmWorksheetService(this.db, this.actor).mutate(
                source,
                recordId,
                core.version,
                patch,
                deleting,
                tx,
              )
            ).version;
          let combined = version + (extension?.version ?? 0);
          if (Object.keys(extras).length)
            combined = (
              await this.saveExtension(
                tableId,
                recordId,
                { values: extras, version: combined, schemaVersion: table.schemaVersion },
                key,
                tx,
              )
            ).version;
          await this.event(tx, table.baseId, deleting ? 'record.deleted' : 'record.updated', recordId);
          return { id: recordId, version: combined };
        },
        transaction,
      );
    }
    if (isEditableBusinessSource(initial.table.source) && recordId) {
      const input = exact(raw, [
        'values', 'version', 'schemaVersion',
        ...(['NEGOTIATIONS', 'CONTRACTS', 'COSTS', 'CUSTOMERS', 'CHANNELS'].includes(initial.table.source) ? ['archived'] : []),
      ]);
      return this.write(
        key,
        ['business.record.save', tableId, recordId, input],
        async (tx) => {
          await this.lock(tx, initial.access.workspaceId, true);
          const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
          const source = table.source;
          if (!isEditableBusinessSource(source)) fail('COLLAB_INVALID_SOURCE');
          if (integer(input.schemaVersion) !== table.schemaVersion) fail('COLLAB_SCHEMA_CONFLICT', 409);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${Prisma.raw(domainSources[source].table)} WHERE id = ${recordId} FOR UPDATE`,
          );
          const core = await new WorkspaceDomainSource(this.db, this.actor).target(
            source,
            access,
            recordId,
            tx,
            input.archived === true ? 'delete' : 'update',
          );
          const extension = await tx.collabExtension.findUnique({
            where: { tableId_recordId: { tableId, recordId } },
          });
          if (integer(input.version) !== core.version + (extension?.version ?? 0))
            fail('COLLAB_RECORD_CONFLICT', 409);
          if (input.archived !== undefined) {
            if (input.archived !== true || Object.keys(object(input.values ?? {})).length)
              fail('COLLAB_INVALID_VALUE');
            const saved = source === 'NEGOTIATIONS' ? await new NegotiationService(this.db, {actorUserId:this.actor.userId},this.actor).deleteNegotiation(recordId,core.version,tx) : source === 'CHANNELS'
              ? (await new ChannelService(this.db, { actorUserId: this.actor.userId }, this.actor).remove(recordId, { version: core.version }, tx), { version: core.version + 1 })
              : source === 'CUSTOMERS'
              ? (await new CustomerService(this.db, { actorUserId: this.actor.userId }, this.actor).deleteCustomer(recordId, { version: core.version }, tx), { version: core.version + 1 })
              : source === 'COSTS'
              ? (await new CostService(this.db, { actorUserId: this.actor.userId }, this.actor).deleteCostEntry(recordId, tx), { version: core.version + 1 })
              : await new ContractService(this.db, { actorUserId: this.actor.userId }, this.actor).mutateDraft(recordId, { version: core.version }, true, tx);
            await this.event(tx, table.baseId, 'record.deleted', recordId);
            return { id: recordId, version: saved.version + (extension?.version ?? 0) };
          }
          const patch: Record<string, unknown> = {},
            extras: ObjectValue = {};
          for (const [id, value] of Object.entries(object(input.values))) {
            const field = fields.find((f) => f.id === id);
            if (!field || access.readonly.includes(id) || isSystemField(field))
              fail('COLLAB_FIELD_UNAVAILABLE', 403);
            const businessKey = String(object(field.options).businessKey ?? '');
            if (!businessKey) {
              extras[id] = value;
              continue;
            }
            if (!editableBusinessKey(source, businessKey, this.actor))
              fail('COLLAB_USE_BUSINESS_ACTION', 409);
            patch[businessKey] = value;
          }
          if (!Object.keys(patch).length && !Object.keys(extras).length) fail('COLLAB_INVALID_VALUE');
          const actor = { actorUserId: this.actor.userId };
          let version = core.version;
          if (Object.keys(patch).length) {
            if (source === 'CONTRACTS')
              version = (
                await new ContractService(this.db, actor, this.actor).mutateDraft(
                  recordId, { ...patch, version: core.version }, false, tx,
                )
              ).version;
            else if (source === 'CUSTOMERS')
              version = (
                await new CustomerService(this.db, actor, this.actor).updateCustomer(
                  recordId,
                  { ...patch, version: core.version } as UpdateCustomerInput,
                  tx,
                )
              ).version;
            else if (source === 'NEGOTIATIONS')
              version = (
                await new NegotiationService(this.db, actor, this.actor).updateNegotiation(
                  recordId,
                  patch as UpdateNegotiationInput,
                  tx,
                )
              ).version;
            else if (source === 'CHANNELS')
              version = (
                await new ChannelService(this.db, actor, this.actor).update(
                  recordId,
                  { ...patch, version: core.version },
                  tx,
                )
              ).version;
            else if (source === 'COSTS')
              version = (
                await new CostService(this.db, actor, this.actor).updateCostEntry(
                  recordId,
                  { ...patch, version: core.version } as UpdateCostEntryInput,
                  tx,
                )
              ).version;
            else if (source === 'PERFORMANCES')
              version = (
                await new PerformanceService(this.db, actor, this.actor).setGoal(
                  recordId,
                  { goal: patch.goal as string, version: core.version },
                  tx,
                )
              ).version;
            else {
              const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: recordId } });
              const data = Object.fromEntries(
                editableBusinessFields.INVENTORY_ITEMS.map((key) => [key, current[key]]),
              );
              version = (
                await new InventoryService(this.db, actor, this.actor).saveItem(
                  {
                    ...data,
                    kind: current.kind,
                    minimumStock: current.minimumStock.toString(),
                    ...patch,
                    version: core.version,
                  },
                  recordId,
                  tx,
                )
              ).version;
            }
          }
          let combined = version + (extension?.version ?? 0);
          if (Object.keys(extras).length)
            combined = (
              await this.saveExtension(
                tableId,
                recordId,
                { values: extras, version: combined, schemaVersion: table.schemaVersion },
                key,
                tx,
              )
            ).version;
          await this.event(tx, table.baseId, 'record.updated', recordId);
          return { id: recordId, version: combined };
        },
        transaction,
      );
    }
    if (initial.table.source === 'CASES' && recordId) {
      const input = exact(raw, ['values', 'version', 'schemaVersion', 'archived']);
      const result = await this.write(
        key,
        ['case.record.save', tableId, recordId, input],
        async (tx) => {
          await this.lock(tx, initial.access.workspaceId, true);
          const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
          if (integer(input.schemaVersion) !== table.schemaVersion) fail('COLLAB_SCHEMA_CONFLICT', 409);
          await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${recordId} FOR UPDATE`;
          const deleting = input.archived === true;
          const core = await new WorkspaceDomainSource(this.db, this.actor).target(
            'CASES',
            access,
            recordId,
            tx,
            deleting ? 'delete' : 'update',
          );
          const extension = await tx.collabExtension.findUnique({
            where: { tableId_recordId: { tableId, recordId } },
          });
          if (integer(input.version) !== core.version + (extension?.version ?? 0))
            fail('COLLAB_RECORD_CONFLICT', 409);
          const service = new CaseService(this.db, { actorUserId: this.actor.userId }, this.actor);
          if (deleting) {
            if (Object.keys(object(input.values ?? {})).length) fail('COLLAB_INVALID_VALUE');
            const files = await service.deleteCaseRecords(recordId, { version: core.version }, tx);
            await this.event(tx, table.baseId, 'record.deleted', recordId);
            return { id: recordId, version: core.version + 1 + (extension?.version ?? 0), files };
          }
          if (input.archived !== undefined) fail('COLLAB_USE_BUSINESS_ACTION', 409);
          const values = object(input.values ?? {});
          if (!Object.keys(values).length) fail('COLLAB_INVALID_VALUE');
          const current = await tx.case.findUniqueOrThrow({ where: { id: recordId } });
          const update: Record<string, unknown> = { version: core.version };
          const extras: ObjectValue = {};
          for (const [id, value] of Object.entries(values)) {
            const field = fields.find((f) => f.id === id);
            if (!field || access.readonly.includes(id) || isSystemField(field))
              fail('COLLAB_FIELD_UNAVAILABLE', 403);
            const businessKey = String(object(field.options).businessKey ?? '');
            if (!businessKey) {
              extras[id] = value;
              continue;
            }
            if (current.contractId && ['intake.contractNumber', 'intake.signedDate', 'intake.region', 'intake.customerPhone'].includes(businessKey)) fail('COLLAB_READONLY_FIELD', 403);
            if (!editableCaseKey(businessKey, this.actor)) fail('COLLAB_USE_BUSINESS_ACTION', 409);
            if (businessKey.startsWith('intake.')) {
              const intake = object(update.intakeData ?? current.intakeData ?? {});
              intake[businessKey.slice(7)] = value === null ? '' : Array.isArray(value) ? JSON.stringify(value) : String(value);
              update.intakeData = intake;
            } else update[businessKey] = businessKey === 'fee' ? String(value ?? '') : value;
          }
          let version = core.version;
          if (Object.keys(update).length > 1) {
            const saved = await service.updateCase(recordId, update as unknown as UpdateCaseInput, tx);
            version = saved.version;
          }
          let combined = version + (extension?.version ?? 0);
          if (Object.keys(extras).length) {
            const saved = await this.saveExtension(
              tableId,
              recordId,
              { values: extras, version: combined, schemaVersion: table.schemaVersion },
              key,
              tx,
            );
            combined = saved.version;
          }
          await this.event(tx, table.baseId, 'record.updated', recordId);
          return { id: recordId, version: combined, files: [] };
        },
        transaction,
      );
      removeStoredAttachments(result.files);
      return { id: result.id, version: result.version };
    }
    return this.saveRecordInTransaction(tableId, recordId, raw, key, transaction);
  }
  private async saveRecordInTransaction(
    tableId: string,
    recordId: string | undefined,
    raw: unknown,
    key: unknown,
    transaction?: Tx,
    restoreMedicalSnapshot=false,
  ) {
    const input = exact(raw, ['values', 'version', 'schemaVersion', 'archived']);
    const initial = await this.tableAccess(tableId, transaction ?? this.db, 2, false, false);
    if (initial.table.source !== 'CUSTOM')
      return this.saveExtension(tableId, recordId, input, key, transaction);
    return this.write(
      key,
      ['record.save', tableId, recordId, input],
      async (tx) => {
        await this.lock(tx, initial.access.workspaceId, true);
        const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
        if (table.source !== 'CUSTOM') fail('COLLAB_USE_BUSINESS_ACTION', 409);
        if (['OFFICE_STOCK', 'ADMIN_MEETINGS', ...caseArchiveKinds].includes(table.inventoryKind || '')) await tx.$queryRaw`SELECT id FROM collab_table WHERE id=${tableId} FOR UPDATE`;
        if (table.schemaVersion !== integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT', 409);
        const previous = recordId
          ? (
              await tx.$queryRaw<CollabRecord[]>(
                Prisma.sql`SELECT * FROM collab_record WHERE id = ${recordId} AND "tableId" = ${tableId} AND archived = false AND ${access.selfOnly ? Prisma.sql`"createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`} FOR UPDATE`,
              )
            )[0]
          : null;
        if (recordId && !previous) fail('COLLAB_NOT_FOUND', 404);
        if (previous && previous.version !== integer(input.version))
          fail('COLLAB_RECORD_CONFLICT', 409, { recordId, version: previous.version });
        const prepared = table.followSupportKind==='MEDICAL_ASSESSMENT' ? await prepareMedicalValues(tx as PrismaClient,this.actor,table.fields,input.values??{},previous?.values,restoreMedicalSnapshot) : input.values??{};
        const next = await this.values(
          tx,
          tableId,
          fields,
          access,
          prepared,
          previous ? hrValues(table.fields,previous.values,false) : {},
          !previous,
        );
        if (
          !previous &&
          table.fields.some(
            (f) => !f.archived && f.required && !fields.some((visible) => visible.id === f.id),
          )
        )
          fail('COLLAB_REQUIRED_FIELD_FORBIDDEN', 403);
        if (!previous) await assignInventoryNumber(tx, tableId, fields, next);
        if (input.archived !== true) await validateOfficeStock(tx, table, table.fields, next, recordId);
        if (input.archived !== true) await validateAdministrativeRecord(tx, table, table.fields, next, recordId);
        if (input.archived !== true) await validateCaseArchiveRecord(tx,table,table.fields,next,recordId);
        if (input.archived !== true) validateHrRecord(table.inventoryKind,table.fields,next);
        const encrypted = hrValues(table.fields,next,true);
        const lifecycleData = table.lifecycleKind ? await this.lifecycle().validate(tx, table, table.fields.filter(f => !f.archived), access, next, previous, input.archived === true) : null;
        const data = {
          values: json(encrypted),
          updatedBy: this.actor.userId,
          archived: input.archived === undefined ? false : boolean(input.archived),
        };
        const record = previous
          ? await tx.collabRecord.update({
              where: { id: recordId },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.collabRecord.create({
              data: { ...data, tableId, createdBy: this.actor.userId, ownerId: this.actor.userId },
            });
        if (isCaseArchiveKind(table.inventoryKind)) await tx.operationLog.create({data:{userId:this.actor.userId,action:input.archived?'CASE_ARCHIVE_DELETE':previous?'CASE_ARCHIVE_UPDATE':'CASE_ARCHIVE_CREATE',targetType:'COLLAB_RECORD',targetId:record.id,newValues:JSON.stringify({tableId,fields:Object.keys(object(input.values??{})),version:record.version})}});
        if (isHrKind(table.inventoryKind)) await tx.operationLog.create({data:{userId:this.actor.userId,action:input.archived?'HR_RECORD_DELETE':previous?'HR_RECORD_UPDATE':'HR_RECORD_CREATE',targetType:'COLLAB_RECORD',targetId:record.id,newValues:JSON.stringify({tableId,fields:Object.keys(object(input.values??{})),version:record.version})}});
        if (lifecycleData) {
          await tx.collabLifecycleLink.upsert({ where: { recordId: record.id }, create: { ...lifecycleData, recordId: record.id }, update: lifecycleData });
          await this.lifecycle().syncFinancialApplication(tx,table,record,table.fields,lifecycleData.caseId);
          await tx.operationLog.create({ data: { userId: this.actor.userId, action: input.archived ? 'LIFECYCLE_DELETE' : previous ? 'LIFECYCLE_UPDATE' : 'LIFECYCLE_CREATE', targetType: 'COLLAB_RECORD', targetId: record.id, newValues: JSON.stringify({ ...lifecycleData, fields: Object.keys(object(input.values ?? {})), version: record.version }) } });
        }
        const changes = Object.fromEntries(
          Object.keys(object(prepared)).map((id) => [
            id,
            { before: previous ? (object(previous.values)[id] ?? null) : null, after: encrypted[id] },
          ]),
        );
        await tx.collabRevision.create({
          data: {
            recordId: record.id,
            version: record.version,
            actorId: this.actor.userId,
            changes: json(changes),
          },
        });
        for (const field of fields.filter((f) => f.type === 'RELATION' && !object(f.options).worksheetMasked)) {
          await tx.collabRelation.deleteMany({ where: { fieldId: field.id, sourceRecordId: record.id } });
          // Canonical business IDs are validated against domain scopes; they are not collab_record IDs.
          if (object(field.options).targetSource) continue;
          const targets = next[field.id];
          if (Array.isArray(targets) && targets.length)
            await tx.collabRelation.createMany({
              data: targets.map((target) => ({
                fieldId: field.id,
                sourceRecordId: record.id,
                targetRecordId: String(target),
              })),
            });
        }
        await this.event(tx, table.baseId, previous ? 'record.updated' : 'record.created', record.id);
        return { id: record.id, version: record.version };
      },
      transaction,
    );
  }
  private batchFailure(error: unknown, index: number): never {
    if (error instanceof CollaborationError) {
      const details = error.errors as { fieldId?: string } | undefined;
      fail(error.code, error.status, {
        row: index + 1,
        ...(details?.fieldId ? { fieldId: details.fieldId } : {}),
      });
    }
    throw error;
  }
  async saveRecords(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['schemaVersion', 'records']);
    const schemaVersion = integer(input.schemaVersion);
    if (!Array.isArray(input.records) || !input.records.length || input.records.length > 100)
      fail('COLLAB_BATCH_LIMIT');
    const records = input.records.map((rawRow) => {
      const row = exact(rawRow, ['id', 'version', 'values']);
      const values = object(row.values);
      if (!Object.keys(values).length) fail('COLLAB_BATCH_EMPTY');
      return {
        id: row.id === undefined ? undefined : text(row.id),
        version: row.id === undefined ? undefined : integer(row.version),
        values,
      };
    });
    const ids = records.flatMap((r) => (r.id ? [r.id] : []));
    if (new Set(ids).size !== ids.length) fail('COLLAB_BATCH_DUPLICATE');
    if (records.reduce((n, r) => n + Object.keys(r.values).length, 0) > 1000) fail('COLLAB_BATCH_LIMIT');
    // Recheck current access before returning a cached result; stale versions remain replayable.
    const initial = await this.tableAccess(tableId, this.db, 2);
    for (const [index, row] of records.entries()) {
      try {
        if (initial.table.source !== 'CUSTOM') {
          if (!row.id) fail('COLLAB_USE_BUSINESS_ACTION', 409);
          await this.extensionTarget(initial.table, initial.access, row.id, this.db);
        } else if (
          row.id &&
          !(await this.db.collabRecord.findFirst({
            where: { ...this.rowWhere(tableId, initial.access), id: row.id },
            select: { id: true },
          }))
        ) {
          fail('COLLAB_NOT_FOUND', 404);
        }
        for (const id of Object.keys(row.values)) {
          if (!initial.fields.some((f) => f.id === id))
            fail('COLLAB_FIELD_UNAVAILABLE', 403, { fieldId: id });
          const field = fieldOf(initial.fields, id);
          if (
            initial.table.source !== 'CUSTOM' &&
            object(field.options).businessKey &&
            !(
              initial.table.source === 'CASES' && editableCaseKey(String(object(field.options).businessKey), this.actor)
            ) &&
            !editableBusinessKey(initial.table.source, String(object(field.options).businessKey), this.actor) &&
            !editableCrmKey(initial.table.source, String(object(field.options).businessKey), this.actor)
          )
            fail('COLLAB_USE_BUSINESS_ACTION', 409, { fieldId: id });
          if (initial.access.readonly.includes(id) || isSystemField(field))
            fail('COLLAB_READONLY_FIELD', 403, { fieldId: id });
        }
      } catch (error) {
        this.batchFailure(error, index);
      }
    }
    return this.write(key, ['records.batch', tableId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const result: Array<{ id: string; version: number }> = [];
      for (const [index, row] of records.entries()) {
        try {
          result.push(
            await this.saveRecord(
              tableId,
              row.id,
              { values: row.values, version: row.version, schemaVersion },
              key,
              tx,
            ),
          );
        } catch (error) {
          this.batchFailure(error, index);
        }
      }
      return { records: result };
    });
  }
  async contractChoices(raw: unknown) {
    const input = exact(raw, ['workspaceId', 'page', 'keyword', 'id']);
    const access = await this.access(text(input.workspaceId));
    const page = input.page === undefined ? 1 : integer(Number(input.page));
    if (page < 1 || page > 100000) fail('COLLAB_INVALID_VALUE');
    const keyword = input.keyword ? text(input.keyword, 100) : '';
    const source = new WorkspaceDomainSource(this.db, this.actor);
    const where = Prisma.sql`${await source.scope('CONTRACTS', access)} AND ${input.id ? Prisma.sql`b.id = ${text(input.id)}` : Prisma.sql`TRUE`} AND (b."contractNo" ILIKE ${'%' + keyword + '%'} OR b.title ILIKE ${'%' + keyword + '%'})`;
    const rows = await this.db.$queryRaw<Array<{ id: string; label: string }>>(
      Prisma.sql`SELECT b.id, b."contractNo" || ' · ' || b.title AS label FROM contract b WHERE ${where} ORDER BY b."createdAt" DESC, b.id LIMIT 20 OFFSET ${(page - 1) * 20}`,
    );
    const [count] = await this.db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM contract b WHERE ${where}`,
    );
    return { list: rows, total: Number(count.total) };
  }
  async options(workspaceId?: string,tableId?:string) {
    const access = tableId ? (await this.tableAccess(tableId)).access : workspaceId ? await this.access(workspaceId) : null;
    if (workspaceId && access?.workspaceId !== workspaceId) fail('COLLAB_FORBIDDEN',403);
    if (
      !access &&
      !this.actor.isSystemSuperAdmin &&
      !this.actor.permissionCodes.some((p) => String(p) === 'workspace.create')
    )
      return { organizations: [], employees: [], teams: [], users: [], positions: [], roles: [] };
    const organizations = await this.db.organization.findMany({
      where: {
        status: 'ENABLED',
        ...(access
          ? { OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }] }
          : this.actor.isSystemSuperAdmin
            ? {}
            : {
                id: {
                  in: (await this.principals(this.db))
                    .filter((p) => p.principalType === 'ORG')
                    .map((p) => p.principalId),
                },
              }),
      },
      select: { id: true, name: true },
      take: 500,
    });
    const employees = await this.db.employee.findMany({
      where: {
        deletedAt: null,
        status: { not: 'LEAVED' },
        assignments: {
          some: {
            startedAt: { lte: new Date() },
            OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }],
            position: { status: 'ENABLED' },
            organizationId: { in: organizations.map((o) => o.id) },
          },
        },
      },
      select: { id: true, name: true, user: { select: { id: true, status: true } } },
      take: 1000,
    });
    const teams = await this.db.professionalTeam.findMany({
      where: { homeOrganizationId: { in: organizations.map((o) => o.id) }, status: 'ENABLED' },
      select: { id: true, name: true },
      take: 500,
    });
    const positions = await this.db.position.findMany({
      where: { organizationId: { in: organizations.map((o) => o.id) }, status: 'ENABLED' },
      select: { id: true, name: true, organization: { select: { name: true } } },
      take: 1000,
    });
    return {
      roles:
        access?.canManageAccess || this.actor.isSystemSuperAdmin
          ? await this.db.role.findMany({
              where: { status: 'ENABLED' },
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            })
          : [],
      positions: positions.map((p) => ({ id: p.id, name: p.organization.name + ' / ' + p.name })),
      organizations,
      employees: employees.map((e) => ({ id: e.id, name: e.name })),
      users:
        access?.canManageAccess || this.actor.isSystemSuperAdmin
          ? (
              await this.db.user.findMany({
                where: {
                  status: 'ENABLED',
                  employee: {
                    deletedAt: null,
                    status: { not: 'LEAVED' },
                    assignments: {
                      some: {
                        startedAt: { lte: new Date() },
                        OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }],
                        position: { status: 'ENABLED' },
                      },
                    },
                  },
                },
                select: { id: true, username: true, employee: { select: { name: true } } },
                orderBy: { username: 'asc' },
                take: 1000,
              })
            ).map((account) => ({ id: account.id, name: account.employee?.name || account.username }))
          : employees
              .filter((e) => e.user?.status === 'ENABLED')
              .map((e) => ({ id: e.user.id, name: e.name })),
      teams,
    };
  }
  async members(workspaceId: string) {
    await this.requireAccessAdmin(workspaceId);
    return this.db.collabMember.findMany({ where: { workspaceId } });
  }
  async saveMember(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'baseId',
      'principalType',
      'principalId',
      'role',
      'canCreate',
      'canManageAccess',
      'rowScope',
      'hiddenFields',
      'readonlyFields',
      'version',
      'remove',
      'tableGrants',
    ]);
    await this.requireAccessAdmin(workspaceId);
    return this.write(key, ['member.save', workspaceId, input], async (tx) => {
      await this.lock(tx, workspaceId);
      const administrator = await this.requireAccessAdmin(workspaceId, tx);
      const principalType = choice(input.principalType, ['USER', 'ORG', 'TEAM', 'POSITION', 'ROLE']);
      const principalId = text(input.principalId);
      if (
        administrator.level < 4 &&
        ((await this.principals(tx)).some(
          (p) => p.principalType === principalType && p.principalId === principalId,
        ) ||
          input.canManageAccess)
      )
        fail('COLLAB_CANNOT_GRANT_ACCESS_ADMIN', 403);
      const workspace = await tx.collabWorkspace.findUnique({ where: { id: workspaceId } });
      if (principalType === 'USER' && principalId === workspace.ownerId) fail('COLLAB_OWNER_IMMUTABLE', 403);
      const options = await this.options(workspaceId);
      const candidates =
        principalType === 'USER'
          ? options.users
          : principalType === 'ORG'
            ? options.organizations
            : principalType === 'POSITION'
              ? options.positions
              : principalType === 'ROLE'
                ? options.roles
                : options.teams;
      if (!input.remove && !candidates.some((c) => c.id === principalId)) fail('COLLAB_MEMBER_UNAVAILABLE');
      const existing = await tx.collabMember.findUnique({
        where: { workspaceId_principalType_principalId: { workspaceId, principalType, principalId } },
      });
      if (existing && existing.version !== integer(input.version)) fail('COLLAB_MEMBER_CONFLICT', 409);
      if (input.remove) {
        if (existing) await tx.collabMember.delete({ where: { id: existing.id } });
      } else {
        const role = choice(input.role, ['READER', 'EDITOR', 'MANAGER']);
        const hiddenFields = strings(input.hiddenFields ?? []);
        const readonlyFields = strings(input.readonlyFields ?? []);
        const known = await tx.collabField.count({
          where: {
            id: { in: [...new Set([...hiddenFields, ...readonlyFields])] },
            table: { base: { workspaceId } },
          },
        });
        if (known !== new Set([...hiddenFields, ...readonlyFields]).size) fail('COLLAB_FIELD_UNAVAILABLE');
        const data = {
          role,
          canCreate: boolean(input.canCreate ?? false),
          rowScope: choice(input.rowScope ?? (role === 'MANAGER' ? 'ALL' : 'SELF'), ['ALL', 'SELF']),
          canManageAccess: boolean(input.canManageAccess ?? false),
          hiddenFields,
          readonlyFields,
        };
        if (
          data.canManageAccess &&
          (role !== 'MANAGER' || data.rowScope !== 'ALL' || hiddenFields.length || readonlyFields.length)
        )
          fail('COLLAB_INVALID_ACCESS_ADMIN');
        if (existing?.canManageAccess && administrator.level < 4)
          fail('COLLAB_CANNOT_GRANT_ACCESS_ADMIN', 403);
        if (existing)
          await tx.collabMember.update({
            where: { id: existing.id },
            data: { ...data, version: { increment: 1 } },
          });
        else await tx.collabMember.create({ data: { ...data, workspaceId, principalType, principalId } });
        if (input.baseId !== undefined) {
          const baseId = text(input.baseId);
          const { base } = await this.resource('BASE', baseId, tx);
          if (base.workspaceId !== workspaceId) fail('COLLAB_NOT_FOUND', 404);
          const policy = resourcePolicy(base.accessPolicy);
          policy.grants = policy.grants.filter(
            (g) => g.principalType !== principalType || g.principalId !== principalId,
          );
          policy.grants.push({
            principalType,
            principalId,
            role,
            rowScope: data.rowScope,
            canCreate: data.canCreate,
            hiddenFields: [],
            readonlyFields: [],
          });
          await tx.collabBase.update({
            where: { id: baseId },
            data: { accessPolicy: json(policy), accessVersion: { increment: 1 } },
          });
        }
        if (input.tableGrants !== undefined) {
          if (!Array.isArray(input.tableGrants) || input.tableGrants.length > 200) fail('COLLAB_INVALID_ACCESS');
          const baseId = text(input.baseId);
          const tables = await tx.collabTable.findMany({
            where: { baseId, base: { workspaceId } },
            select: { id: true, accessPolicy: true },
          });
          const known = new Map(tables.map((table) => [table.id, table]));
          for (const item of input.tableGrants) {
            const grant = exact(item, ['tableId', 'role']);
            const tableId = text(grant.tableId);
            const table = known.get(tableId);
            if (!table) fail('COLLAB_NOT_FOUND', 404);
            const tableRole = choice(grant.role, ['DENY', 'READER', 'EDITOR', 'MANAGER']);
            const policy = resourcePolicy(table.accessPolicy);
            policy.grants = policy.grants.filter(
              (g) => g.principalType !== principalType || g.principalId !== principalId,
            );
            policy.grants.push({
              principalType,
              principalId,
              role: tableRole,
              rowScope: tableRole === 'DENY' ? 'ALL' : data.rowScope,
              canCreate: tableRole === 'DENY' ? false : data.canCreate,
              hiddenFields: [],
              readonlyFields: [],
            });
            await tx.collabTable.update({
              where: { id: tableId },
              data: { accessPolicy: json(policy), accessVersion: { increment: 1 } },
            });
          }
        }
      }
      await tx.collabWorkspace.update({ where: { id: workspaceId }, data: { version: { increment: 1 } } });
      const bases = await tx.collabBase.findMany({ where: { workspaceId } });
      for (const b of bases) await this.event(tx, b.id, 'access.updated', workspaceId);
      return { id: existing?.id ?? principalId };
    });
  }
}
