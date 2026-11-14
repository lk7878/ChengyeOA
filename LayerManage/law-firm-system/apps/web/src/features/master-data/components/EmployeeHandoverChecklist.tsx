import { Alert, Empty } from 'antd';
import type { EmployeeOffboarding } from '../types';

const statuses: Record<string, string> = { PENDING: '待处理', ACCEPTED: '已受理', PROCESSING: '处理中', NEW: '新线索', ASSIGNED: '已分配', CONTACTED: '已联系', SCREENED: '已筛选', INVITED: '已邀约', VISITED: '已到访', NURTURE: '培育中' };
export default function EmployeeHandoverChecklist({ data }: { data: EmployeeOffboarding }) {
  const rows = [
    ...data.blockers.cases.map(item => ({ key: `case-${item.id}`, title: `案件 ${item.caseNo} · ${item.title}（${statuses[item.status] ?? item.status}）`, path: `/cases/${item.id}`, hint: '更换主办律师或办结案件' })),
    ...data.blockers.leads.map(item => ({ key: `lead-${item.id}`, title: `线索 ${item.leadNo} · ${item.name}（${statuses[item.status] ?? item.status}）`, path: `/leads/${item.id}`, hint: '重新分配负责人或完成线索' })),
    ...data.blockers.subordinates.map(item => ({ key: `report-${item.id}`, title: `在任下属 ${item.employee.name} · ${item.employee.employeeNo}`, path: '/org/employees', hint: '更换直属上级或结束汇报关系' })),
    ...data.blockers.organizations.map(item => ({ key: `org-${item.id}`, title: `组织负责人 ${item.name} · ${item.code}`, path: '/org/tree', hint: '更换或清空组织负责人' })),
    ...data.blockers.teams.map(item => ({ key: `team-${item.id}`, title: `团队负责人 ${item.professionalTeam.name} · ${item.professionalTeam.code}`, path: '/org/professional-teams', hint: '移交团队负责人职责' })),
  ];
  return <section aria-label="离职交接清单">
    <Alert type={rows.length ? 'warning' : 'success'} showIcon title={rows.length ? `还有 ${rows.length} 项关联事项需要交接` : '未发现阻止离职或删除的业务关联'} />
    {rows.length ? <ul>{rows.map(row => <li key={row.key}><a href={row.path} target="_blank" rel="noopener noreferrer">{row.title}</a><div>{row.hint}</div></li>)}</ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="交接清单为空" />}
    <p>账号：{data.account ? `${data.account.username}（${data.account.status === 'ENABLED' ? '使用中' : data.account.status === 'DELETED' ? '已注销' : '已暂停'}）` : '未绑定账号'}</p>
    <p>待移交资源：文档 {data.resources.documents ?? 0}，工作区 {data.resources.workspaces ?? 0}，记录 {data.resources.records ?? 0}，附件 {(data.resources.attachments ?? 0) + (data.resources.approvalAttachments ?? 0)}，视图 {data.resources.views ?? 0}，规则 {data.resources.rules ?? 0}，工资材料 {data.resources.payrollBatches ?? 0}。包含未分享及回收站内文档。</p>
  </section>;
}
