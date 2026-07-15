import { Application } from 'egg';

export default (app: Application) => {
  const { router, controller } = app;

  // 健康检查
  router.get('/api/health', controller.home.index);

  // 认证模块（不需要 JWT）
  router.post('/api/v1/auth/login', controller.auth.login);
  router.post('/api/v1/auth/refresh', controller.auth.refresh);
  router.post('/api/v1/auth/password/forced-change', controller.auth.forcePasswordChange);
  
  // 需要 JWT 认证的路由
  router.get('/api/v1/auth/me', controller.auth.me);
  router.post('/api/v1/auth/logout', controller.auth.logout);

  // 用户模块
  router.get('/api/v1/users', controller.user.index);
  router.get('/api/v1/users/:id', controller.user.show);
  router.post('/api/v1/users', controller.user.create);
  router.put('/api/v1/users/:id', controller.user.update);
  router.delete('/api/v1/users/:id', controller.user.destroy);
  router.post('/api/v1/users/:id/roles', controller.user.assignRoles);

  // 角色模块
  router.get('/api/v1/roles', controller.role.index);
  router.get('/api/v1/roles/:id', controller.role.show);
  router.post('/api/v1/roles', controller.role.create);
  router.put('/api/v1/roles/:id', controller.role.update);
  router.delete('/api/v1/roles/:id', controller.role.destroy);
  router.post('/api/v1/roles/:id/permissions', controller.role.assignPermissions);

  // 权限模块
  router.get('/api/v1/permissions', controller.permission.index);
  router.get('/api/v1/permissions/tree', controller.permission.tree);

  // 组织架构模块
  router.get('/api/v1/organizations', controller.organization.index);
  router.get('/api/v1/organizations/tree', controller.organization.tree);
  router.get('/api/v1/organizations/:id', controller.organization.show);
  router.post('/api/v1/organizations', controller.organization.create);
  router.put('/api/v1/organizations/:id', controller.organization.update);
  router.delete('/api/v1/organizations/:id', controller.organization.destroy);

  // 岗位模块
  router.get('/api/v1/positions', controller.position.index);
  router.get('/api/v1/positions/:id', controller.position.show);
  router.post('/api/v1/positions', controller.position.create);
  router.put('/api/v1/positions/:id', controller.position.update);
  router.delete('/api/v1/positions/:id', controller.position.destroy);

  // 员工模块
  router.get('/api/v1/employees', controller.employee.index);
  router.get('/api/v1/employees/:id', controller.employee.show);
  router.post('/api/v1/employees', controller.employee.create);
  router.put('/api/v1/employees/:id', controller.employee.update);
  router.delete('/api/v1/employees/:id', controller.employee.destroy);
  router.post('/api/v1/employees/:id/formalize', controller.employee.formalize);
  router.post('/api/v1/employees/:id/leave', controller.employee.leave);

  // 渠道模块
  router.get('/api/v1/channels', controller.channel.index);
  router.get('/api/v1/channels/:id', controller.channel.show);
  router.post('/api/v1/channels', controller.channel.create);
  router.put('/api/v1/channels/:id', controller.channel.update);
  router.delete('/api/v1/channels/:id', controller.channel.destroy);
  router.get('/api/v1/channels/:id/statistics', controller.channel.statistics);

  // 线索模块
  router.get('/api/v1/leads', controller.lead.index);
  router.get('/api/v1/leads/:id', controller.lead.show);
  router.post('/api/v1/leads', controller.lead.create);
  router.put('/api/v1/leads/:id', controller.lead.update);
  router.delete('/api/v1/leads/:id', controller.lead.destroy);
  router.post('/api/v1/leads/:id/assign', controller.lead.assign);
  router.post('/api/v1/leads/:id/follow', controller.lead.follow);
  router.post('/api/v1/leads/:id/convert', controller.lead.convert);
  router.get('/api/v1/leads/:id/follows', controller.lead.follows);
  router.post('/api/v1/leads/:id/recycle', controller.lead.recycle);

  // 客户模块
  router.get('/api/v1/customers', controller.customer.index);
  router.get('/api/v1/customers/:id', controller.customer.show);
  router.post('/api/v1/customers', controller.customer.create);
  router.put('/api/v1/customers/:id', controller.customer.update);
  router.delete('/api/v1/customers/:id', controller.customer.destroy);
  router.get('/api/v1/customers/:id/contracts', controller.customer.contracts);
  router.get('/api/v1/customers/:id/cases', controller.customer.cases);
  router.get('/api/v1/customers/:id/payments', controller.customer.payments);

  // 合同模块
  router.get('/api/v1/contracts', controller.contract.index);
  router.get('/api/v1/contracts/:id', controller.contract.show);
  router.post('/api/v1/contracts', controller.contract.create);
  router.put('/api/v1/contracts/:id', controller.contract.update);
  router.delete('/api/v1/contracts/:id', controller.contract.destroy);
  router.post('/api/v1/contracts/:id/submit', controller.contract.submit);
  router.post('/api/v1/contracts/:id/approve', controller.contract.approve);
  router.post('/api/v1/contracts/:id/sign', controller.contract.sign);
  router.post('/api/v1/contracts/:id/terminate', controller.contract.terminate);
  router.get('/api/v1/contracts/ledger', controller.contract.ledger);

  // 收款模块
  router.get('/api/v1/payments', controller.payment.index);
  router.get('/api/v1/payments/:id', controller.payment.show);
  router.post('/api/v1/payments', controller.payment.create);
  router.put('/api/v1/payments/:id', controller.payment.update);
  router.delete('/api/v1/payments/:id', controller.payment.destroy);
  router.post('/api/v1/payments/:id/confirm', controller.payment.confirm);
  router.post('/api/v1/payments/:id/refund', controller.payment.refund);

  // 案件模块
  router.get('/api/v1/cases', controller.case.index);
  router.get('/api/v1/cases/:id', controller.case.show);
  router.post('/api/v1/cases', controller.case.create);
  router.put('/api/v1/cases/:id', controller.case.update);
  router.delete('/api/v1/cases/:id', controller.case.destroy);
  router.post('/api/v1/cases/:id/tasks', controller.case.createTask);
  router.patch('/api/v1/cases/:id/tasks/:taskId', controller.case.updateTask);
  router.post('/api/v1/cases/:id/communications', controller.case.createCommunication);
  router.post('/api/v1/cases/:id/close', controller.case.close);

  // 审批模块
  router.get('/api/v1/approvals', controller.approval.index);
  router.get('/api/v1/approvals/:id', controller.approval.show);
  router.post('/api/v1/approvals', controller.approval.create);
  router.post('/api/v1/approvals/:id/process', controller.approval.process);

  // 通知模块
  router.get('/api/v1/notifications', controller.notification.index);
  router.patch('/api/v1/notifications/:id/read', controller.notification.read);
  router.post('/api/v1/notifications/read-all', controller.notification.readAll);
  router.get('/api/v1/notifications/unread-count', controller.notification.unreadCount);

  // 绩效模块
  router.get('/api/v1/performances', controller.performance.index);
  router.get('/api/v1/performances/:id', controller.performance.show);
  router.post('/api/v1/performances', controller.performance.create);
  router.post('/api/v1/performances/:id/confirm', controller.performance.confirm);

  // 仪表盘模块
  router.get('/api/v1/dashboard/metrics', controller.dashboard.metrics);
  router.get('/api/v1/dashboard/funnel', controller.dashboard.funnel);
  router.get('/api/v1/dashboard/team-metrics', controller.dashboard.teamMetrics);
  router.get('/api/v1/dashboard/finance-metrics', controller.dashboard.financeMetrics);
  router.get('/api/v1/dashboard/case-metrics', controller.dashboard.caseMetrics);
  router.get('/api/v1/dashboard/alerts', controller.dashboard.alerts);

  // SPA fallback: 非 API 路径返回前端 index.html（需在所有 API 路由之后）
  router.get('/*', controller.home.spa);
};
