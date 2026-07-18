import { EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Form, Input, Modal, Select, Table, Tag, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { userApi } from '@/api/user';
import { masterDataApi } from '@/features/master-data/api';
import AssignmentDialog from '@/features/master-data/components/AssignmentDialog';
import EmployeeDetailDrawer from '@/features/master-data/components/EmployeeDetailDrawer';
import EmployeeForm from '@/features/master-data/components/EmployeeForm';
import type { SelectOption } from '@/features/master-data/components/EmployeeForm';
import type { AssignmentType, CreateEmployeeInput, EmployeeAssignment, EmployeeDetail, EmployeeListItem, EmployeeStatus, OrganizationNode, Position, ProfessionalTeam, UpdateEmployeeInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';

type EmployeeFormValues = CreateEmployeeInput & { version?: number };
type AssignmentValues = { organizationId: string; positionId: string; assignmentType?: AssignmentType };
const statusOptions = [{ value: 'PROBATION', label: '试用' }, { value: 'FORMAL', label: '正式' }, { value: 'LEAVED', label: '已离职' }];
const statusText = { PROBATION: '试用', FORMAL: '正式', LEAVED: '已离职' } as const;

function flatten(nodes: OrganizationNode[]): OrganizationNode[] { return nodes.flatMap(node => [node, ...flatten(node.children)]); }
function errorStatus(error: unknown): number | undefined { return (error as { response?: { status?: number } })?.response?.status; }

export default function EmployeePage() {
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [formPositions, setFormPositions] = useState<Position[]>([]);
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const [users, setUsers] = useState<SelectOption[]>([]);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<EmployeeStatus>();
  const [organizationId, setOrganizationId] = useState<string>();
  const [teamId, setTeamId] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [formalOpen, setFormalOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [handoverConfirmed, setHandoverConfirmed] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'transfer' | 'add'>();
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [employeeForm] = Form.useForm<EmployeeFormValues>();
  const [assignmentForm] = Form.useForm<AssignmentValues>();
  const [formalForm] = Form.useForm<{ formalDate: string }>();
  const [leaveForm] = Form.useForm<{ leaveDate: string }>();

  const flatOrganizations = useMemo(() => flatten(organizations), [organizations]);
  const organizationOptions = useMemo(() => flatOrganizations.map(item => ({ value: item.id, label: item.name })), [flatOrganizations]);
  const positionOptions = useMemo(() => formPositions.filter(item => item.status === 'ENABLED').map(item => ({ value: item.id, label: item.name })), [formPositions]);
  const organizationNames = useMemo(() => new Map(flatOrganizations.map(item => [item.id, item.name])), [flatOrganizations]);
  const positionNames = useMemo(() => new Map(positions.map(item => [item.id, item.name])), [positions]);
  const teamNames = useMemo(() => new Map(teams.map(item => [item.id, item.name])), [teams]);

  const load = useCallback(async (requestedPage = page, requestedPageSize = pageSize) => {
    setLoading(true); setError(undefined);
    try {
      const response = await masterDataApi.employees.list({ page: requestedPage, pageSize: requestedPageSize, keyword: keyword || undefined, status, organizationId, teamId });
      setEmployees(response.data.list); setTotal(response.data.pagination.total);
      const organizationIds = [...new Set(response.data.list.flatMap(item => item.primaryAssignment?.organizationId ?? []))];
      const positionResponses = await Promise.all(organizationIds.map(id => masterDataApi.positions.list({ organizationId: id })));
      setPositions(current => {
        const merged = new Map(current.map(item => [item.id, item]));
        positionResponses.flatMap(item => item.data).forEach(item => merged.set(item.id, item));
        return [...merged.values()];
      });
    } catch (cause) { setError(errorStatus(cause) === 403 ? '您没有权限查看人员主数据' : '人员数据加载失败'); }
    finally { setLoading(false); }
  }, [keyword, organizationId, page, pageSize, status, teamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void (async () => {
      setLoading(true); setError(undefined);
      try {
        const [orgResponse, teamResponse, employeeResponse] = await Promise.all([
          masterDataApi.organizations.tree(), masterDataApi.professionalTeams.list({ page: 1, pageSize: 100 }), masterDataApi.employees.list({ page: 1, pageSize: 20 }),
        ]);
        setOrganizations(orgResponse.data); setTeams(teamResponse.data.list);
        setEmployees(employeeResponse.data.list); setTotal(employeeResponse.data.pagination.total);
        const organizationIds = [...new Set(employeeResponse.data.list.flatMap(item => item.primaryAssignment?.organizationId ?? []))];
        const positionResponses = await Promise.all(organizationIds.map(id => masterDataApi.positions.list({ organizationId: id })));
        setPositions(positionResponses.flatMap(item => item.data));
      } catch (cause) { setError(errorStatus(cause) === 403 ? '您没有权限查看人员主数据' : '人员数据加载失败'); }
      finally { setLoading(false); }
    })(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function positionsFor(organization: string, form = employeeForm) {
    form.setFieldValue('primaryPositionId', undefined);
    assignmentForm.setFieldValue('positionId', undefined);
    try { const response = await masterDataApi.positions.list({ organizationId: organization, status: 'ENABLED' }); setFormPositions(response.data); }
    catch { setFormPositions([]); message.error('岗位选项加载失败'); }
  }

  async function openDetail(employee: EmployeeListItem) {
    try {
      const [employeeResponse, userResponse] = await Promise.all([masterDataApi.employees.detail(employee.id), userApi.list({ page: 1, pageSize: 100, status: 'ENABLED' })]);
      setDetail(employeeResponse.data); setUsers(userResponse.data.list.filter(user => !user.employeeId || user.employeeId === employee.id).map(user => ({ value: user.id, label: user.username })));
    } catch { message.error('员工详情加载失败'); }
  }
  async function refreshDetail() { if (!detail) return; const response = await masterDataApi.employees.detail(detail.id); setDetail(response.data); await load(); }

  async function submitCreate() {
    const values = await employeeForm.validateFields(); setSubmitting(true);
    try { await masterDataApi.employees.create(values); message.success('员工已创建'); setCreateOpen(false); employeeForm.resetFields(); await load(1); }
    catch { message.error('创建未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submitEdit() {
    if (!detail) return; const values = await employeeForm.validateFields(); setSubmitting(true);
    try { await masterDataApi.employees.update(detail.id, { ...values, employeeNo: undefined, entryDate: undefined, primaryOrganizationId: undefined, primaryPositionId: undefined, version: detail.version } as UpdateEmployeeInput); message.success('档案已更新'); setEditOpen(false); await refreshDetail(); }
    catch { message.error('更新未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submitFormalize() { if (!detail) return; const values = await formalForm.validateFields(); setSubmitting(true); try { await masterDataApi.employees.formalize(detail.id, { ...values, version: detail.version }); setFormalOpen(false); await refreshDetail(); } catch { message.error('转正未完成'); } finally { setSubmitting(false); } }
  async function submitLeave() { if (!detail || !handoverConfirmed) return; const values = await leaveForm.validateFields(); setSubmitting(true); try { await masterDataApi.employees.leave(detail.id, { ...values, handoverConfirmed: true, version: detail.version }); setLeaveOpen(false); await refreshDetail(); } catch { message.error('离职未完成，请检查保护条件'); } finally { setSubmitting(false); } }
  async function submitAssignment(values: AssignmentValues) { if (!detail || !assignmentMode) return; setSubmitting(true); try { if (assignmentMode === 'transfer') await masterDataApi.employees.transferPrimary(detail.id, { organizationId: values.organizationId, positionId: values.positionId, employeeVersion: detail.version }); else await masterDataApi.employees.addAssignment(detail.id, { organizationId: values.organizationId, positionId: values.positionId, assignmentType: values.assignmentType === 'ACTING' ? 'ACTING' : 'SECONDARY' }); setAssignmentMode(undefined); await refreshDetail(); } catch { message.error('任职变更未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function endAssignment(assignment: EmployeeAssignment) { if (!detail) return; try { await masterDataApi.employees.endAssignment(detail.id, assignment.id, { version: assignment.version }); await refreshDetail(); } catch { message.error('结束任职失败'); } }
  async function bindAccount() { if (!detail || !selectedUserId) return; try { await masterDataApi.employees.bindAccount(detail.id, { userId: selectedUserId, employeeVersion: detail.version }); setSelectedUserId(undefined); await refreshDetail(); } catch { message.error('账号绑定失败'); } }
  async function unbindAccount() { if (!detail) return; try { await masterDataApi.employees.unbindAccount(detail.id, { version: detail.version }); await refreshDetail(); } catch { message.error('解除绑定失败'); } }

  return <section className="md-page"><header className="md-toolbar"><div><h1>员工与任职</h1><p>员工档案与任职关系分离管理，所有组织归属以生效任职为准。</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => { employeeForm.resetFields(); setFormPositions([]); setCreateOpen(true); }}>新增员工</Button></header>
    <div className="md-filter-bar"><Input placeholder="姓名或工号" value={keyword} onChange={event => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); void load(1); }} prefix={<SearchOutlined />} /><Select aria-label="员工状态" allowClear placeholder="状态" value={status} options={statusOptions} onChange={setStatus} /><Select aria-label="组织筛选" allowClear showSearch placeholder="组织" value={organizationId} options={organizationOptions} onChange={setOrganizationId} /><Select aria-label="团队筛选" allowClear showSearch placeholder="专业团队" value={teamId} options={teams.map(item => ({ value: item.id, label: item.name }))} onChange={setTeamId} /><Button type="primary" onClick={() => { setPage(1); void load(1); }}>查询</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></div>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Table rowKey="id" loading={loading} dataSource={employees} scroll={{ x: 1060 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); void load(nextPage, nextSize); } }} columns={[
      { title: '工号', dataIndex: 'employeeNo', width: 120 }, { title: '姓名', dataIndex: 'name', width: 120 }, { title: '状态', dataIndex: 'status', width: 90, render: (value: EmployeeStatus) => <Tag>{statusText[value]}</Tag> },
      { title: '主组织', dataIndex: 'primaryAssignment', width: 150, render: (value: EmployeeListItem['primaryAssignment']) => value ? organizationNames.get(value.organizationId) || value.organizationId : '-' },
      { title: '主岗位', dataIndex: 'primaryAssignment', width: 120, render: (value: EmployeeListItem['primaryAssignment']) => value ? positionNames.get(value.positionId) || value.positionId : '-' },
      { title: '专业团队', dataIndex: 'activeProfessionalTeamIds', width: 160, render: (ids: string[]) => ids.map(id => teamNames.get(id) || id).join('、') || '-' },
      { title: '人员类型', dataIndex: 'employeeType', width: 120 }, { title: '入职日期', dataIndex: 'entryDate', width: 130, render: (value: string) => value.slice(0, 10) },
      { title: '操作', width: 84, render: (_: unknown, row: EmployeeListItem) => <Button type="text" icon={<EyeOutlined />} aria-label={`查看${row.name}`} onClick={() => void openDetail(row)} /> },
    ]} />
    <Modal title="新增员工" open={createOpen} confirmLoading={submitting} onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()} width={680} destroyOnHidden><EmployeeForm form={employeeForm} organizations={organizationOptions} positions={positionOptions} onOrganizationChange={id => void positionsFor(id)} /></Modal>
    <Modal title="编辑基础档案" open={editOpen} confirmLoading={submitting} onCancel={() => setEditOpen(false)} onOk={() => void submitEdit()} width={680} destroyOnHidden><EmployeeForm form={employeeForm} editing organizations={organizationOptions} positions={[]} onOrganizationChange={() => undefined} /></Modal>
    <Modal title="员工转正" open={formalOpen} confirmLoading={submitting} onCancel={() => setFormalOpen(false)} onOk={() => void submitFormalize()} destroyOnHidden><Form form={formalForm} layout="vertical"><Form.Item name="formalDate" label="转正日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Form></Modal>
    <Modal title="办理离职" open={leaveOpen} confirmLoading={submitting} okButtonProps={{ disabled: !handoverConfirmed }} onCancel={() => setLeaveOpen(false)} onOk={() => void submitLeave()} destroyOnHidden><Form form={leaveForm} layout="vertical"><Form.Item name="leaveDate" label="离职日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Form><Checkbox checked={handoverConfirmed} onChange={event => setHandoverConfirmed(event.target.checked)}>确认交接完成后才能提交离职</Checkbox></Modal>
    <AssignmentDialog open={Boolean(assignmentMode)} title={assignmentMode === 'transfer' ? '调动主职' : '新增兼任'} form={assignmentForm} organizations={organizationOptions} positions={positionOptions} allowType={assignmentMode === 'add'} submitting={submitting} onOrganizationChange={id => void positionsFor(id, employeeForm)} onCancel={() => setAssignmentMode(undefined)} onSubmit={values => void submitAssignment(values)} />
    <EmployeeDetailDrawer employee={detail} open={Boolean(detail)} organizations={organizationNames} positions={positionNames} teams={teamNames} users={users} selectedUserId={selectedUserId} onClose={() => setDetail(null)} onEdit={() => { if (!detail) return; employeeForm.setFieldsValue(detail); setEditOpen(true); }} onFormalize={() => { formalForm.resetFields(); setFormalOpen(true); }} onLeave={() => { leaveForm.resetFields(); setHandoverConfirmed(false); setLeaveOpen(true); }} onTransfer={() => { assignmentForm.resetFields(); setFormPositions([]); setAssignmentMode('transfer'); }} onAddAssignment={() => { assignmentForm.resetFields(); setFormPositions([]); setAssignmentMode('add'); }} onEndAssignment={assignment => void endAssignment(assignment)} onSelectUser={setSelectedUserId} onBind={() => void bindAccount()} onUnbind={() => void unbindAccount()} />
  </section>;
}
