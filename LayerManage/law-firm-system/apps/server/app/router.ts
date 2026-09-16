import { Application } from 'egg';
import { requireOrganizationSuperAdmin } from './middleware/requireOrganizationSuperAdmin';
import { requirePermission } from './middleware/requirePermission';
import { requireAnyPermission } from './middleware/requireAnyPermission';

export default (app: Application) => {
  const { router, controller } = app;

  // SPEC-COLLAB: authenticated endpoints; services enforce resource permissions.
  router.get('/api/v1/collaboration/business-tables', controller.collaboration.businessTables);
  router.post('/api/v1/tables/:tableId/business-records', controller.collaboration.createBusinessRecord);
  router.get('/api/v1/workspaces', controller.collaboration.index);
  router.get('/api/v1/workspaces/:workspaceId/drive', controller.drive.index);
  router.get('/api/v1/workspaces/:workspaceId/drive/folders', controller.drive.folders);
  router.post('/api/v1/workspaces/:workspaceId/drive/folders', controller.drive.createFolder);
  router.post('/api/v1/workspaces/:workspaceId/drive/bases', controller.drive.createBase);
  router.post('/api/v1/workspaces/:workspaceId/drive/shortcuts', controller.drive.createShortcut);
  router.get('/api/v1/drive/shortcuts/:shortcutId', controller.drive.shortcut);
  router.post('/api/v1/workspaces/:workspaceId/drive/shortcuts/:shortcutId/remove', controller.drive.removeShortcut);
  router.post('/api/v1/drive/nodes/:nodeId/visit', controller.drive.visit);
  router.post('/api/v1/workspaces/:workspaceId/drive/recent/clear', controller.drive.clearRecent);
  router.get('/api/v1/drive/nodes/:nodeId', controller.drive.node);
  router.patch('/api/v1/drive/nodes/:nodeId', controller.drive.rename);
  router.post('/api/v1/drive/nodes/:nodeId/lifecycle/preview', controller.drive.previewLifecycle);
  router.post('/api/v1/drive/nodes/:nodeId/lifecycle', controller.drive.applyLifecycle);
  router.get('/api/v1/drive/folders/:folderId/access', controller.drive.access);
  router.post('/api/v1/drive/folders/:folderId/access', controller.drive.saveAccess);
  router.post('/api/v1/workspaces', controller.collaboration.createWorkspace);
  router.get('/api/v1/collaboration/options', controller.collaboration.options);
  router.post('/api/v1/workspaces/:workspaceId/bases', controller.collaboration.createBase);
  router.get('/api/v1/workspaces/:workspaceId/members', controller.collaboration.members);
  router.post('/api/v1/workspaces/:workspaceId/members', controller.collaboration.saveMember);
  router.get('/api/v1/bases/:baseId/access', controller.collaboration.resourceAccess);
  router.post('/api/v1/bases/:baseId/access', controller.collaboration.saveResourceAccess);
  router.get('/api/v1/tables/:tableId/access', controller.collaboration.resourceAccess);
  router.post('/api/v1/tables/:tableId/access', controller.collaboration.saveResourceAccess);
  router.get('/api/v1/bases/:baseId/tables', controller.collaboration.tables);
  router.post('/api/v1/bases/:baseId/tables/reorder', controller.collaboration.reorderTables);
  router.post('/api/v1/bases/:baseId/tables', controller.collaboration.createTable);
  router.get('/api/v1/tables/:tableId', controller.collaboration.table);
  router.patch('/api/v1/tables/:tableId', controller.collaboration.mutateTable);
  router.post('/api/v1/tables/:tableId/fields', controller.collaboration.field);
  router.patch('/api/v1/tables/:tableId/fields/:fieldId', controller.collaboration.field);
  router.post('/api/v1/tables/:tableId/views', controller.collaboration.view);
  router.patch('/api/v1/tables/:tableId/views/:viewId', controller.collaboration.view);
  router.post('/api/v1/tables/:tableId/records/batch', controller.collaboration.saveRecords);
  router.post('/api/v1/tables/:tableId/records/query', controller.collaboration.query);
  router.get('/api/v1/tables/:tableId/records/:recordId/business', controller.collaboration.businessDetail);
  router.post('/api/v1/tables/:tableId/records/:recordId/business', controller.collaboration.businessAction);
  router.get('/api/v1/tables/:tableId/records/:recordId', controller.collaboration.record);
  router.post('/api/v1/tables/:tableId/records', controller.collaboration.saveRecord);
  router.patch('/api/v1/tables/:tableId/records/:recordId', controller.collaboration.saveRecord);
  router.get('/api/v1/collaboration/events', controller.collaboration.events);
  router.post('/api/v1/tables/:tableId/files', controller.collaboration.upload);
  router.get('/api/v1/tables/:tableId/files/:fileId', controller.collaboration.download);

  router.post('/api/v1/intelligence/knowledge', controller.intelligence.knowledge);
  router.post('/api/v1/intelligence/desktop-knowledge', controller.intelligence.desktopKnowledge);
  router.post('/api/v1/intelligence/case', controller.intelligence.caseOperation);
  router.post('/api/v1/intelligence/events', controller.intelligence.events);

  // 健康检查
  router.get('/api/health', controller.home.index);

  // 认证模块（不需要 JWT）
  router.post('/api/v1/auth/login', controller.auth.login);
  router.post('/api/v1/auth/refresh', controller.auth.refresh);
  router.post('/api/v1/auth/password/forced-change', controller.auth.forcePasswordChange);
  router.post('/api/v1/auth/mfa/enrollment', controller.auth.beginMfaEnrollment);
  router.post('/api/v1/auth/mfa/enrollment/confirm', controller.auth.confirmMfaEnrollment);
  router.post('/api/v1/auth/mfa/verify', controller.auth.verifyMfa);
  
  // 需要 JWT 认证的路由
  router.get('/api/v1/auth/me', controller.auth.me);
  router.post('/api/v1/auth/logout', controller.auth.logout);
  router.post('/api/v1/auth/logout-all', controller.auth.logoutAll);
  router.get('/api/v1/auth/sessions', controller.auth.sessions);
  router.delete('/api/v1/auth/sessions/:id', controller.auth.revokeSession);
  router.post('/api/v1/auth/step-up', controller.auth.stepUp);
  router.get('/api/v1/auth/mfa', controller.auth.mfaStatus);
  router.post('/api/v1/auth/mfa/enrollment/start', controller.auth.startMfaEnrollment);
  router.delete('/api/v1/auth/mfa', controller.auth.disableMfa);
  router.post('/api/v1/auth/mfa/recovery-codes', controller.auth.regenerateRecoveryCodes);

  // Authorization center
  router.get('/api/v1/authorization/me', controller.authorization.me);
  router.get('/api/v1/authorization/me/trace', requirePermission('permission.trace.self'), controller.authorization.myTrace);
  router.post('/api/v1/authorization/sensitive-view', requirePermission('employee.high_sensitive.read'), controller.authorization.sensitiveView);
  router.get('/api/v1/authorization/trace/users/:id', requirePermission('permission.trace.any'), controller.authorization.traceUser);

  // Administrator governance
  router.get('/api/v1/admin-governance/catalog', requirePermission('governance.catalog.read'), controller.adminGovernance.catalog);
  router.get('/api/v1/admin-governance/targets/users', requirePermission('governance.catalog.read'), controller.adminGovernance.targetUsers);
  router.post('/api/v1/admin-governance/operations', requirePermission('governance.operation.create'), controller.adminGovernance.create);
  router.get('/api/v1/admin-governance/operations', controller.adminGovernance.index);
  router.get('/api/v1/admin-governance/operations/:id', controller.adminGovernance.show);
  router.post('/api/v1/admin-governance/operations/:id/review', requirePermission('governance.review'), controller.adminGovernance.review);
  router.post('/api/v1/admin-governance/operations/:id/cancel', controller.adminGovernance.cancel);
  router.post('/api/v1/admin-governance/operations/:id/retry', requirePermission('governance.retry'), controller.adminGovernance.retry);

  // Event operations
  router.get('/api/v1/event-operations/summary', requirePermission('event.delivery.read'), controller.eventOperations.summary);
  router.get('/api/v1/event-operations/deliveries', requirePermission('event.delivery.read'), controller.eventOperations.index);
  router.get('/api/v1/event-operations/deliveries/:id', requirePermission('event.delivery.read'), controller.eventOperations.show);
  router.get('/api/v1/event-operations/subscriptions', requirePermission('event.delivery.read'), controller.eventOperations.subscriptions);
  router.post('/api/v1/event-operations/deliveries/:id/retry', requirePermission('event.delivery.retry'), controller.eventOperations.retry);

  // 用户模块
  router.get('/api/v1/users', requirePermission('user.read'), controller.user.index);
  router.get('/api/v1/users/:id', requirePermission('user.read'), controller.user.show);
  router.post('/api/v1/users', requirePermission('user.create'), controller.user.create);
  router.put('/api/v1/users/:id', requirePermission('user.update'), controller.user.update);
  router.delete('/api/v1/users/:id', requirePermission('user.status.manage'), controller.user.destroy);
  router.get('/api/v1/users/:id/authorization', requirePermission('user.read'), controller.user.authorization);
  // SPEC-015 follow-up（业务角色成员指派）：治理码 user.role.manage 或委派码
  // user_role.membership.manage 任一可过 router 门控；治理语义由 service 层 assertMayManage 收紧。
  router.post('/api/v1/users/:id/role-grants', requireAnyPermission(['user.role.manage', 'user_role.membership.manage']), controller.user.grantRole);
  router.post('/api/v1/users/:id/role-grants/:grantId/revoke', requireAnyPermission(['user.role.manage', 'user_role.membership.manage']), controller.user.revokeRoleGrant);
  router.post('/api/v1/users/:id/special-grants', requirePermission('temporary_grant.manage'), controller.user.grantSpecial);
  router.post('/api/v1/users/:id/special-grants/:grantId/revoke', requirePermission('temporary_grant.manage'), controller.user.revokeSpecialGrant);

  // 角色模块
  router.get('/api/v1/roles', requirePermission('role.read'), controller.role.index);
  router.get('/api/v1/roles/:id', requirePermission('role.read'), controller.role.show);
  // SPEC-015 follow-up（业务角色成员指派）：per-role 成员列表——role.read 或委派码任一可过。
  router.get('/api/v1/roles/:id/members', requireAnyPermission(['role.read', 'user_role.membership.manage']), controller.role.members);
  router.post('/api/v1/roles', requirePermission('role.create'), controller.role.create);
  router.patch('/api/v1/roles/:id', requirePermission('role.update'), controller.role.update);
  router.post('/api/v1/roles/:id/disable', requirePermission('role.status.manage'), controller.role.disable);
  router.post('/api/v1/roles/:id/enable', requirePermission('role.status.manage'), controller.role.enable);
  router.put('/api/v1/roles/:id/permissions', requirePermission('role.permission.manage'), controller.role.replacePermissions);
  router.put('/api/v1/roles/:id/data-scopes', requirePermission('role.permission.manage'), controller.role.replaceDataScopes);
  router.put('/api/v1/roles/:id/field-permissions', requirePermission('role.permission.manage'), controller.role.replaceFieldPermissions);

  // 权限模块
  router.get('/api/v1/permissions/catalog', requirePermission('permission.catalog.read'), controller.permission.catalog);
  router.get('/api/v1/permissions/fields', requirePermission('role.permission.manage'), controller.permission.fields);
  router.get('/api/v1/permissions/data-scopes', requirePermission('role.permission.manage'), controller.permission.dataScopes);
  router.post('/api/v1/permissions/data-scopes', requirePermission('role.permission.manage'), controller.permission.createDataScope);

  // 组织架构模块
  router.get('/api/v1/organizations/options', requirePermission('organization.read'), controller.organization.options);
  router.get('/api/v1/organizations/manager-options', requireOrganizationSuperAdmin, requirePermission('organization.read'), controller.organization.managerOptions);
  router.post('/api/v1/organizations/:id/copy', requireOrganizationSuperAdmin, requirePermission('organization.create'), controller.organization.copy);
  router.delete('/api/v1/organizations/:id', requireOrganizationSuperAdmin, requirePermission('organization.update'), controller.organization.destroy);
  router.get('/api/v1/organizations/tree', requireOrganizationSuperAdmin, requirePermission('organization.read'), controller.organization.tree);
  router.get('/api/v1/organizations/:id', requireOrganizationSuperAdmin, requirePermission('organization.read'), controller.organization.show);
  router.post('/api/v1/organizations', requireOrganizationSuperAdmin, requirePermission('organization.create'), controller.organization.create);
  router.patch('/api/v1/organizations/:id', requireOrganizationSuperAdmin, requirePermission('organization.update'), controller.organization.update);
  router.post('/api/v1/organizations/:id/move', requireOrganizationSuperAdmin, requirePermission('organization.move'), controller.organization.move);
  router.post('/api/v1/organizations/:id/disable', requireOrganizationSuperAdmin, requirePermission('organization.status.manage'), controller.organization.disable);
  router.post('/api/v1/organizations/:id/enable', requireOrganizationSuperAdmin, requirePermission('organization.status.manage'), controller.organization.enable);

  // 岗位模块
  router.get('/api/v1/positions', requirePermission('position.read'), controller.position.index);
  router.get('/api/v1/positions/:id', requirePermission('position.read'), controller.position.show);
  router.post('/api/v1/positions', requirePermission('position.create'), controller.position.create);
  router.patch('/api/v1/positions/:id', requirePermission('position.update'), controller.position.update);
  router.delete('/api/v1/positions/:id', requirePermission('position.update'), controller.position.destroy);
  router.post('/api/v1/positions/:id/disable', requirePermission('position.status.manage'), controller.position.disable);
  router.post('/api/v1/positions/:id/enable', requirePermission('position.status.manage'), controller.position.enable);

  // 员工模块
  router.get('/api/v1/employees', requirePermission('employee.read'), controller.employee.index);
  router.get('/api/v1/employees/:id', requirePermission('employee.read'), controller.employee.show);
  router.post('/api/v1/employees', requirePermission('employee.create'), controller.employee.create);
  router.patch('/api/v1/employees/:id', requirePermission('employee.update'), controller.employee.update);
  router.post('/api/v1/employees/:id/formalize', requirePermission('employee.formalize'), controller.employee.formalize);
  router.delete('/api/v1/employees/:id', requirePermission('employee.leave'), controller.employee.destroy);
  router.post('/api/v1/employees/:id/leave', requirePermission('employee.leave'), controller.employee.leave);
  router.post('/api/v1/employees/:id/assignments/transfer', requirePermission('employee.assignment.manage'), controller.employeeAssignment.transfer);
  router.post('/api/v1/employees/:id/assignments', requirePermission('employee.assignment.manage'), controller.employeeAssignment.create);
  router.post('/api/v1/employees/:id/assignments/:assignmentId/end', requirePermission('employee.assignment.manage'), controller.employeeAssignment.end);
  router.put('/api/v1/employees/:id/account-binding', requirePermission('employee.account_binding.manage'), controller.employeeAccountBinding.update);
  router.delete('/api/v1/employees/:id/account-binding', requirePermission('employee.account_binding.manage'), controller.employeeAccountBinding.destroy);
  router.get('/api/v1/employees/:id/reporting-lines', requirePermission('employee.reporting_line.read'), controller.employeeReportingLine.index);
  router.post('/api/v1/employees/:id/reporting-lines', requirePermission('employee.reporting_line.manage'), controller.employeeReportingLine.create);
  router.post('/api/v1/employees/:id/reporting-lines/:lineId/end', requirePermission('employee.reporting_line.manage'), controller.employeeReportingLine.end);

  // 专业团队模块
  router.get('/api/v1/professional-teams', requirePermission('professional_team.read'), controller.professionalTeam.index);
  router.get('/api/v1/professional-teams/:id', requirePermission('professional_team.read'), controller.professionalTeam.show);
  router.post('/api/v1/professional-teams', requirePermission('professional_team.create'), controller.professionalTeam.create);
  router.patch('/api/v1/professional-teams/:id', requirePermission('professional_team.update'), controller.professionalTeam.update);
  router.post('/api/v1/professional-teams/:id/disable', requirePermission('professional_team.status.manage'), controller.professionalTeam.disable);
  router.post('/api/v1/professional-teams/:id/enable', requirePermission('professional_team.status.manage'), controller.professionalTeam.enable);
  router.post('/api/v1/professional-teams/:id/members', requirePermission('professional_team.member.manage'), controller.professionalTeam.addMember);
  router.post('/api/v1/professional-teams/:id/members/:memberId/end', requirePermission('professional_team.member.manage'), controller.professionalTeam.endMember);
  router.post('/api/v1/professional-teams/:id/lead', requirePermission('professional_team.lead.manage'), controller.professionalTeam.replaceLead);

  // 渠道模块
  router.get('/api/v1/sop/templates', requirePermission('sop.template.read'), controller.sop.templates);
  router.get('/api/v1/sop/templates/:id', requirePermission('sop.template.read'), controller.sop.template);
  router.get('/api/v1/sop/template-versions/:id', requirePermission('sop.template.read'), controller.sop.templateVersion);
  router.post('/api/v1/sop/templates', requirePermission('sop.template.manage'), controller.sop.createTemplate);
  router.post('/api/v1/sop/templates/:id/versions', requirePermission('sop.template.manage'), controller.sop.copyVersion);
  router.put('/api/v1/sop/template-versions/:id', requirePermission('sop.template.manage'), controller.sop.updateVersion);
  router.get('/api/v1/sop/template-options', requirePermission('sop.template.manage'), controller.sop.options);
  router.get('/api/v1/sop/template-presets', requirePermission('sop.template.manage'), controller.sop.presets);
  router.get('/api/v1/channels', controller.channel.index);
  router.get('/api/v1/channels/identity-gaps', controller.channel.identityGaps);
  router.post('/api/v1/channels/:id/identity', controller.channel.repairIdentity);
  router.get('/api/v1/channels/:id', controller.channel.show);
  router.post('/api/v1/channels', controller.channel.create);
  router.put('/api/v1/channels/:id', controller.channel.update);
  router.delete('/api/v1/channels/:id', controller.channel.destroy);
  router.get('/api/v1/channels/:id/statistics', controller.channel.statistics);

  // 线索模块（SPEC-009 Task 10 重建：全部经 requirePermission；pool 字面量路由必须先于 /:id 注册。
  // recycleOverdueLeads 系统任务入口刻意无路由——lead-assignment-service 决策 7 守卫注记。）
  router.post('/api/v1/leads/pool/claim', requirePermission('lead.pool.claim'), controller.lead.claim);
  router.get('/api/v1/leads/pool', requirePermission('lead.read'), controller.lead.pool);
  router.post('/api/v1/leads', requirePermission('lead.create'), controller.lead.create);
  router.get('/api/v1/leads', requirePermission('lead.read'), controller.lead.index);
  router.get('/api/v1/leads/:id', requirePermission('lead.read'), controller.lead.show);
  router.patch('/api/v1/leads/:id', requirePermission('lead.update'), controller.lead.update);
  router.post('/api/v1/leads/:id/assign', requirePermission('lead.assign'), controller.lead.assign);
  router.post('/api/v1/leads/:id/recycle', requirePermission('lead.recycle'), controller.lead.recycle);
  router.post('/api/v1/leads/:id/convert', requirePermission('lead.convert'), controller.lead.convert);
  router.post('/api/v1/leads/:id/follows', requirePermission('lead.update'), controller.lead.follow);
  router.get('/api/v1/leads/:id/follows', requirePermission('lead.read'), controller.lead.follows);
  router.get('/api/v1/leads/:id/appointments', requirePermission('appointment.read'), controller.lead.appointments);

  // 邀约模块（SPEC-009 Task 10：markNoShow/cancel 服务方法存在但 brief 未要求路由，不暴露；
  // 顶层日历范围查询经 2026-07-29 用户裁定开放（VisitCalendarPage），注册在 /:id 之前。）
  router.post('/api/v1/appointments', requirePermission('appointment.create'), controller.appointment.create);
  router.post('/api/v1/appointments/:id/visit', requirePermission('appointment.visit'), controller.appointment.visit);
  router.post('/api/v1/appointments/:id/reschedule', requirePermission('appointment.create'), controller.appointment.reschedule);
  router.get('/api/v1/appointments', requirePermission('appointment.read'), controller.appointment.index);
  router.get('/api/v1/appointments/:id', requirePermission('appointment.read'), controller.appointment.show);

  // 客户模块（SPEC-CUSTOMER-CRUD-20260914 增加受权限保护的软删除；
  // 原型跨模块只读子资源 /contracts /cases /payments 移除，归 Task 11 前端重组。）
  router.post('/api/v1/customers', requirePermission('customer.create'), controller.customer.create);
  router.get('/api/v1/customers', requirePermission('customer.read'), controller.customer.index);
  router.get('/api/v1/customers/:id', requirePermission('customer.read'), controller.customer.show);
  router.patch('/api/v1/customers/:id', requirePermission('customer.update'), controller.customer.update);
  router.delete('/api/v1/customers/:id', requirePermission('customer.delete'), controller.customer.destroy);
  // SPEC-039：客户域转介绍端点（/customers/:id/referrals）——POST 挂 lead.create（登记 REFERRAL 线索）、
  // GET 挂 lead.read（列表）。字面量子路径先于 /:id 后段无冲突（referrals 为独立子段）。
  router.post('/api/v1/customers/:id/referrals', requirePermission('lead.create'), controller.customer.createReferral);
  router.get('/api/v1/customers/:id/referrals', requirePermission('lead.read'), controller.customer.listReferrals);
  router.get('/api/v1/customers/:id/contacts', requirePermission('customer.read'), controller.customer.listContacts);
  router.post('/api/v1/customers/:id/contacts', requirePermission('customer.update'), controller.customer.addContact);
  router.patch('/api/v1/customers/:id/contacts/:contactId', requirePermission('customer.update'), controller.customer.updateContact);
  router.delete('/api/v1/customers/:id/contacts/:contactId', requirePermission('customer.update'), controller.customer.removeContact);

  // 谈案模块（SPEC-010 Task 10：全部经 requirePermission，仿 SPEC-009 T10 先例）。
  router.post('/api/v1/negotiations', requirePermission('negotiation.create'), controller.negotiation.create);
  router.get('/api/v1/negotiations', requirePermission('negotiation.read'), controller.negotiation.index);
  router.get('/api/v1/negotiations/:id', requirePermission('negotiation.read'), controller.negotiation.show);
  router.patch('/api/v1/negotiations/:id', requirePermission('negotiation.update'), controller.negotiation.update);
  router.post('/api/v1/negotiations/:id/close', requirePermission('negotiation.update'), controller.negotiation.close);

  // 合同/收款模块（SPEC-010 Task 10 重建：全部经 requirePermission。合同无 update/delete
  // 路由——创建后仅经动作路由流转，设计如此；原型 PUT/DELETE /contracts/:id、/contracts/ledger、
  // PUT/DELETE /payments/:id、/payments/:id/refund 已随 Task 1 原型根除，由 API 测试 404 锁死。）
  router.post('/api/v1/contracts', requirePermission('contract.create'), controller.contract.create);
  router.get('/api/v1/contracts', requirePermission('contract.read'), controller.contract.index);
  router.get('/api/v1/contracts/:id', requirePermission('contract.read'), controller.contract.show);
  router.post('/api/v1/contracts/:id/submit', requirePermission('contract.submit'), controller.contract.submit);
  router.post('/api/v1/contracts/:id/approve', requirePermission('contract.approve'), controller.contract.approve);
  router.post('/api/v1/contracts/:id/reject', requirePermission('contract.approve'), controller.contract.reject);
  router.post('/api/v1/contracts/:id/sign', requirePermission('contract.sign'), controller.contract.sign);
  router.post('/api/v1/contracts/:id/effect', requirePermission('contract.effect'), controller.contract.effect);
  router.post('/api/v1/contracts/:id/terminate', requirePermission('contract.terminate'), controller.contract.terminate);
  router.post('/api/v1/contracts/:id/void', requirePermission('contract.void'), controller.contract.void);
  router.get('/api/v1/contracts/:id/plans', requirePermission('payment.read'), controller.contract.plans);
  router.post('/api/v1/payments', requirePermission('payment.create'), controller.payment.create);
  router.get('/api/v1/payments', requirePermission('payment.read'), controller.payment.index);
  router.get('/api/v1/payments/:id', requirePermission('payment.read'), controller.payment.show);
  router.post('/api/v1/payments/:id/confirm', requirePermission('payment.confirm'), controller.payment.confirm);

  // 财务运营模块（SPEC-011 Task 10：全部经 requirePermission，仿 SPEC-010 T10 先例。
  // reject 挂 approve 码沿 router.ts:183 先例——catalog 无 invoice.reject/refund.reject 码。）
  router.post('/api/v1/invoices', requirePermission('invoice.create'), controller.invoice.create);
  router.get('/api/v1/invoices', requirePermission('invoice.read'), controller.invoice.index);
  router.get('/api/v1/invoices/:id', requirePermission('invoice.read'), controller.invoice.show);
  router.post('/api/v1/invoices/:id/approve', requirePermission('invoice.approve'), controller.invoice.approve);
  router.post('/api/v1/invoices/:id/reject', requirePermission('invoice.approve'), controller.invoice.reject);
  router.post('/api/v1/invoices/:id/complete', requirePermission('invoice.complete'), controller.invoice.complete);
  router.post('/api/v1/refunds', requirePermission('refund.create'), controller.refund.create);
  router.get('/api/v1/refunds', requirePermission('refund.read'), controller.refund.index);
  router.get('/api/v1/refunds/:id', requirePermission('refund.read'), controller.refund.show);
  router.post('/api/v1/refunds/:id/approve', requirePermission('refund.approve'), controller.refund.approve);
  router.post('/api/v1/refunds/:id/reject', requirePermission('refund.approve'), controller.refund.reject);
  router.post('/api/v1/refunds/:id/execute', requirePermission('refund.execute'), controller.refund.execute);
  router.post('/api/v1/payments/:id/void', requirePermission('payment.void'), controller.payment.void);
  router.post('/api/v1/costs', requirePermission('cost.create'), controller.cost.create);
  router.get('/api/v1/costs', requirePermission('cost.read'), controller.cost.index);
  router.get('/api/v1/costs/:id', requirePermission('cost.read'), controller.cost.show);
  router.patch('/api/v1/costs/:id', requirePermission('cost.update'), controller.cost.update);
  router.delete('/api/v1/costs/:id', requirePermission('cost.delete'), controller.cost.destroy);
  router.get('/api/v1/finance/anomalies/signed-unpaid', requirePermission('anomaly.read'), controller.anomaly.signedUnpaid);
  router.get('/api/v1/finance/anomalies/received-uninvoiced', requirePermission('anomaly.read'), controller.anomaly.receivedUninvoiced);
  router.get('/api/v1/finance/anomalies/first-sign-no-formal', requirePermission('anomaly.read'), controller.anomaly.firstSignNoFormal);
  router.get('/api/v1/finance/anomalies/paid-no-case', requirePermission('anomaly.read'), controller.anomaly.paidNoCase);

  // 案件模块（SPEC-033：+requirePermission 门禁；移除 destroy——案件业务不可删，归档替代；路由 15→22）
  router.get('/api/v1/cases/identity-gaps', requirePermission('case.read'), controller.case.identityGaps);
  router.post('/api/v1/cases/:id/identity', requirePermission('case.update'), controller.case.repairIdentity);
  router.get('/api/v1/cases', requirePermission('case.read'), controller.case.index);
  router.get('/api/v1/cases/:id', requirePermission('case.read'), controller.case.show);
  router.post('/api/v1/cases', requirePermission('case.create'), controller.case.create);
  router.put('/api/v1/cases/:id', requirePermission('case.update'), controller.case.update);
  router.delete('/api/v1/cases/:id', requirePermission('case.delete'), controller.case.destroy);
  router.post('/api/v1/cases/:id/tasks', requirePermission('case.task.manage'), controller.case.createTask);
  router.patch('/api/v1/cases/:id/tasks/:taskId', requirePermission('case.task.manage'), controller.case.updateTask);
  router.post('/api/v1/cases/:id/communications', requirePermission('case.communication.create'), controller.case.createCommunication);
  router.post('/api/v1/cases/:id/status', requirePermission('case.read'), controller.case.transition);
  router.post('/api/v1/cases/:id/close', requirePermission('case.close'), controller.case.close);
  // SPEC-042：案件文件/证据——listFiles/uploadFile 挂 /cases/:id/files；download/remove 挂 /files/:id。
  router.get('/api/v1/cases/:id/files', requirePermission('case.file.read'), controller.case.listFiles);
  router.post('/api/v1/cases/:id/files', requirePermission('case.file.manage'), controller.case.uploadFile);
  router.get('/api/v1/files/:id/download', requirePermission('case.file.read'), controller.case.downloadFile);
  router.delete('/api/v1/files/:id', requirePermission('case.file.manage'), controller.case.removeFile);

  // 审批中心模块（SPEC-013 Task 6：全部经 requirePermission。definitions 字面量路由必须先于
  // /:id 注册——与 anomaly 先例同；design 修正补 definitions 目录路由供前端表单渲染。
  // SPEC-017 Task 2：+3 定义管理路由（approval.manage）。/definitions/manage 字面量必须先于
  // PATCH /definitions/:code 注册，防 manage 被 :code 吞并；GET /definitions（approval.apply）保持最前。
  // SPEC-025 Task 2：+2 定义配置迁移路由（approval.manage）——/definitions/export 与
  // /definitions/import 字面量同样先于 PATCH /definitions/:code（沿 manage 字面量优先先例）。
  // approval 域路由 11→13。）
  router.post('/api/v1/approvals/personal-definitions', requirePermission('approval.apply'), controller.approval.createPersonalDefinition);
  router.post('/api/v1/approval-files', requirePermission('approval.apply'), controller.approvalAttachment.upload);
  router.get('/api/v1/approval-files/:id', controller.approvalAttachment.download);
  router.delete('/api/v1/approval-files/:id', requirePermission('approval.apply'), controller.approvalAttachment.remove);
  router.post('/api/v1/approval-files/:id/clone', requirePermission('approval.apply'), controller.approvalAttachment.clone);
  router.get('/api/v1/approvals/:id/files', controller.approvalAttachment.list);
  router.get('/api/v1/approvals/:id/material', controller.approvalAttachment.material);
  router.get('/api/v1/approvals/definitions', requirePermission('approval.apply'), controller.approval.definitions);
  router.post('/api/v1/approvals/definitions', requirePermission('approval.manage'), controller.approval.createDefinition);
  router.get('/api/v1/approvals/definitions/manage', requirePermission('approval.manage'), controller.approval.listDefinitionsManage);
  router.get('/api/v1/approvals/definitions/export', requirePermission('approval.manage'), controller.approval.exportDefinitions);
  router.post('/api/v1/approvals/definitions/import', requirePermission('approval.manage'), controller.approval.importDefinitions);
  router.patch('/api/v1/approvals/definitions/:code', requirePermission('approval.manage'), controller.approval.updateDefinition);
  router.get('/api/v1/approvals', requirePermission('approval.read'), controller.approval.index);
  // SPEC-028：/approvals/export 字面量必须先于 /approvals/:id 注册，防 export 被 :id 吞并（approval 域路由 13→14）。
  router.get('/api/v1/approvals/export', requirePermission('approval.manage'), controller.approval.exportInstances);
  // SPEC-030：/approvals/stats 字面量先于 :id（approval 域路由 14→15）。
  router.get('/api/v1/approvals/stats', requirePermission('approval.manage'), controller.approval.stats);
  router.get('/api/v1/approvals/:id', requirePermission('approval.read'), controller.approval.show);
  router.post('/api/v1/approvals', requirePermission('approval.apply'), controller.approval.create);
  router.post('/api/v1/approvals/:id/withdraw', requirePermission('approval.apply'), controller.approval.withdraw);
  router.post('/api/v1/approvals/:id/process', requirePermission('approval.process'), controller.approval.process);
  router.post('/api/v1/approvals/:id/forward', requirePermission('approval.process'), controller.approval.forward);
  router.post('/api/v1/approvals/:id/add-signers', requirePermission('approval.process'), controller.approval.addSigners);

  // 通知模块
  router.get('/api/v1/notifications', controller.notification.index);
  router.patch('/api/v1/notifications/:id/read', controller.notification.read);
  router.post('/api/v1/notifications/read-all', controller.notification.readAll);
  router.get('/api/v1/notifications/unread-count', controller.notification.unreadCount);

  // 绩效模块（SPEC-037：+requirePermission 门禁——替代遗留原型直连 prisma，路由 22→26）
  router.get('/api/v1/performances', requirePermission('performance.read'), controller.performance.index);
  router.get('/api/v1/performances/:id', requirePermission('performance.read'), controller.performance.show);
  // SPEC-044：绩效业务指标（/performances/:id/metrics 字面量先于 :id 后段无冲突——metrics 为独立子段）。
  router.get('/api/v1/performances/:id/metrics', requirePermission('performance.read'), controller.performance.metrics);
  router.post('/api/v1/performances', requirePermission('performance.create'), controller.performance.create);
  router.post('/api/v1/performances/:id/confirm', requirePermission('performance.confirm'), controller.performance.confirm);
  // SPEC-043：绩效考核流程——目标设定/自评挂 performance.update、主管评挂 performance.confirm。
  router.post('/api/v1/performances/:id/set-goal', requirePermission('performance.update'), controller.performance.setGoal);
  router.post('/api/v1/performances/:id/self-review', requirePermission('performance.update'), controller.performance.selfReview);
  router.post('/api/v1/performances/:id/manager-review', requirePermission('performance.confirm'), controller.performance.managerReview);

  // 仪表盘模块
  router.get('/api/v1/dashboard/metrics', controller.dashboard.metrics);
  router.get('/api/v1/dashboard/funnel', controller.dashboard.funnel);
  router.get('/api/v1/dashboard/team-metrics', controller.dashboard.teamMetrics);
  router.get('/api/v1/dashboard/finance-metrics', controller.dashboard.financeMetrics);
  router.get('/api/v1/dashboard/case-metrics', controller.dashboard.caseMetrics);
  router.get('/api/v1/dashboard/alerts', controller.dashboard.alerts);

  router.post('/api/v1/cases/:id/finance-contract', requirePermission('case.update'), controller.businessIntegration.bindCase);
  router.get('/api/v1/approval-ledger', requirePermission('approval.read'), controller.businessIntegration.ledger);
  router.post('/api/v1/approval-ledger/:id/retry', requirePermission('approval.manage'), controller.businessIntegration.retry);
  router.get('/api/v1/approval-sync-rules', requirePermission('approval.manage'), controller.businessIntegration.rules);
  router.put('/api/v1/approval-sync-rules/:id', requirePermission('approval.manage'), controller.businessIntegration.setRule);
  router.get('/api/v1/payroll-batches', requirePermission('performance.read'), controller.businessIntegration.payrollList);
  router.post('/api/v1/payroll-batches', requirePermission('performance.create'), controller.businessIntegration.payrollSave);
  router.put('/api/v1/payroll-batches/:id', requirePermission('performance.update'), controller.businessIntegration.payrollSave);

  router.get('/api/v1/inventory', requirePermission('inventory.read'), controller.inventory.index);
  router.get('/api/v1/inventory/items/:id', requirePermission('inventory.read'), controller.inventory.showItem);
  router.get('/api/v1/inventory/movements/:id', requirePermission('inventory.read'), controller.inventory.showMovement);
  router.get('/api/v1/inventory/stocktakes/:id', requirePermission('inventory.read'), controller.inventory.showStocktake);
  router.get('/api/v1/inventory/recipients', requirePermission('inventory.outbound'), controller.inventory.recipients);
  router.get('/api/v1/inventory/export', requirePermission('inventory.export'), controller.inventory.export);
  router.post('/api/v1/inventory/items', requirePermission('inventory.manage'), controller.inventory.save);
  router.put('/api/v1/inventory/items/:id', requirePermission('inventory.manage'), controller.inventory.save);
  router.post('/api/v1/inventory/movements', controller.inventory.move);
  router.post('/api/v1/inventory/stocktakes', requirePermission('inventory.stocktake'), controller.inventory.stocktake);

  // SPA fallback: 非 API 路径返回前端 index.html（需在所有 API 路由之后）
  router.get('/*', controller.home.spa);
};
