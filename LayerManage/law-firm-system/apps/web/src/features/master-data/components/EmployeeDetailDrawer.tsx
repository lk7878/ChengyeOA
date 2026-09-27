import Table from '@/components/ResizableTable';
import { Button, Descriptions, Popconfirm, Space, Tabs, Tag } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import type { EmployeeAssignment, EmployeeDetail } from '../types';
import AccountBindingPanel from './AccountBindingPanel';
import type { SelectOption } from './EmployeeForm';
import SensitiveEmployeeFields from './SensitiveEmployeeFields';
import { useAuthStore } from '@/stores/authStore';
import { employeeTypeLabel } from '@/locales/employee-types';

interface Props {
  employee: EmployeeDetail | null;
  open: boolean;
  organizations: Map<string, string>;
  positions: Map<string, string>;
  teams: Map<string, string>;
  users: SelectOption[];
  selectedUserId?: string;
  onClose: () => void;
  onEdit: () => void;
  onFormalize: () => void;
  onLeave: () => void;
  onTransfer: () => void;
  onAddAssignment: () => void;
  onEndAssignment: (assignment: EmployeeAssignment) => void;
  onSelectUser: (id: string) => void;
  onBind: () => void;
  onUnbind: () => void;
}

const statusText = { PROBATION: '试用', FORMAL: '正式', LEAVED: '已离职' } as const;
const assignmentText = { PRIMARY: '主职', SECONDARY: '兼任', ACTING: '代理' } as const;

export default function EmployeeDetailDrawer(props: Props) {
  const employee = props.employee;
  const mayViewL4 = useAuthStore(state => state.hasPermission('employee.high_sensitive.read'));
  return <Drawer title={employee ? `${employee.name} · ${employee.employeeNo}` : '员工详情'} open={props.open} onClose={props.onClose} size="large">
    {employee && <Tabs items={[
      { key: 'profile', label: '基础档案', children: <>
        <div className="md-detail-heading"><div><h2>基础档案</h2><Tag color={employee.status === 'LEAVED' ? 'default' : 'blue'}>{statusText[employee.status]}</Tag></div><Space wrap>
          <Button onClick={props.onEdit}>编辑档案</Button>
          {employee.status === 'PROBATION' && <Button type="primary" onClick={props.onFormalize}>转正</Button>}
          {employee.status !== 'LEAVED' && <Button danger onClick={props.onLeave}>办理离职</Button>}
        </Space></div>
        <Descriptions column={{ xs: 1, sm: 2 }} items={[
          { key: 'type', label: '人员类型', children: employeeTypeLabel(employee.employeeType) }, { key: 'phone', label: '手机号', children: employee.phone ?? '无权查看' },
          { key: 'email', label: '邮箱', children: employee.email === undefined ? '无权查看' : employee.email || '-' }, { key: 'license', label: '执业证号', children: employee.licenseNo === undefined ? '无权查看' : employee.licenseNo || '-' },
          { key: 'idCard', label: '身份证号', children: <SensitiveEmployeeFields employeeId={employee.id} allowed={mayViewL4} /> }, { key: 'entryDate', label: '入职日期', children: employee.entryDate.slice(0, 10) },
          { key: 'formalDate', label: '转正日期', children: employee.formalDate?.slice(0, 10) || '-' }, { key: 'leaveDate', label: '离职日期', children: employee.leaveDate?.slice(0, 10) || '-' },
          { key: 'directions', label: '专业方向', children: employee.professionalDirections === undefined ? '无权查看' : employee.professionalDirections.join('、') || '-' },
        ]} />
      </> },
      { key: 'assignments', label: '任职关系', children: <>
        {employee.status !== 'LEAVED' && <Space wrap className="md-section-actions"><Button type="primary" onClick={props.onTransfer}>调动主职</Button><Button onClick={props.onAddAssignment}>新增兼任</Button></Space>}
        <Table rowKey="id" size="small" pagination={false} dataSource={employee.assignments} columns={[
          { title: '类型', dataIndex: 'assignmentType', render: (value: EmployeeAssignment['assignmentType']) => assignmentText[value] },
          { title: '组织', dataIndex: 'organizationId', width: 300, render: (id: string) => <span title={props.organizations.get(id) || id}>{props.organizations.get(id) || id}</span> },
          { title: '岗位', dataIndex: 'positionId', render: (id: string) => props.positions.get(id) || id },
          { title: '开始日期', dataIndex: 'startedAt', render: (value: string) => value.slice(0, 10) },
          { title: '状态', dataIndex: 'endedAt', render: (value: string | null) => value ? `已结束 ${value.slice(0, 10)}` : '生效中' },
          { title: '操作', render: (_: unknown, row: EmployeeAssignment) => row.assignmentType !== 'PRIMARY' && !row.endedAt ? <Popconfirm title="确认结束该任职？" onConfirm={() => props.onEndAssignment(row)}><Button size="small">结束任职</Button></Popconfirm> : null },
        ]} />
      </> },
      { key: 'teams', label: '专业团队', children: employee.professionalTeams.length ? <ul className="md-history-list">{employee.professionalTeams.map(member => <li key={member.id}><strong>{props.teams.get(member.professionalTeamId) || member.professionalTeamId}</strong><span>{member.memberRole}</span><span>{member.endedAt ? `已退出 ${member.endedAt.slice(0, 10)}` : '生效中'}</span></li>)}</ul> : <p>暂无专业团队记录</p> },
      { key: 'account', label: '账号绑定', children: <AccountBindingPanel account={employee.account} users={props.users} selectedUserId={props.selectedUserId} onSelect={props.onSelectUser} onBind={props.onBind} onUnbind={props.onUnbind} /> },
    ]} />}
  </Drawer>;
}
