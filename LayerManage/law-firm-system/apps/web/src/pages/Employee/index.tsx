import { employeeTypeLabel } from '@/locales/employee-types';
import { organizationNamePaths } from '@/features/master-data/organization-utils';
import Table from '@/components/ResizableTable';
import { validateForm } from '@/features/master-data/form-rules';
import { showRequestError } from '@/api/errors';
import { EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Form, Input, Select, Space, Tag, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { userApi } from '@/api/user';
import { masterDataApi } from '@/features/master-data/api';
import AssignmentDialog from '@/features/master-data/components/AssignmentDialog';
import EmployeeDetailDrawer from '@/features/master-data/components/EmployeeDetailDrawer';
import EmployeeForm from '@/features/master-data/components/EmployeeForm';
import type { SelectOption } from '@/features/master-data/components/EmployeeForm';
import type { AssignmentType, CreateEmployeeInput, EmployeeAssignment, EmployeeDetail, EmployeeListItem, EmployeeStatus, OrganizationNode, Position, ProfessionalTeam, UpdateEmployeeInput } from '@/features/master-data/types';
import { useAuthStore } from '@/stores/authStore';
import '@/features/master-data/master-data.css';

type EmployeeFormValues = CreateEmployeeInput & { version?: number };
type AssignmentValues = { organizationId: string; positionId: string; assignmentType?: AssignmentType };
const statusOptions = [{ value: 'PROBATION', label: '试用' }, { value: 'FORMAL', label: '正式' }, { value: 'LEAVED', label: '已离职' }];
const statusText = { PROBATION: '试用', FORMAL: '正式', LEAVED: '已离职' } as const;

function errorStatus(error: unknown): number | undefined { return (error as { response?: { status?: number } })?.response?.status; }

export default function EmployeePage() {
  const canDelete = useAuthStore(state => Boolean(state.authorization?.isSystemSuperAdmin));
  const [deleteTarget, setDeleteTarget] = useState<EmployeeListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canReadOrganizations = useAuthStore(state => state.hasPermission('organization.read'));
  const canReadPositions = useAuthStore(state => state.hasPermission('position.read'));
  const canReadTeams = useAuthStore(state => state.hasPermission('professional_team.read'));
  const canReadApproval = useAuthStore(s => s.hasPermission('approval.read'));
  const canReadUsers = useAuthStore(state => state.hasPermission('user.read'));
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

  const organizationNames = useMemo(() => organizationNamePaths(organizations), [organizations]);
  const organizationOptions = useMemo(() => [...organizationNames].map(([value, label]) => ({ value, label })), [organizationNames]);
  const positionOptions = useMemo(() => formPositions.filter(item => item.status === 'ENABLED').map(item => ({ value: item.id, label: item.name })), [formPositions]);
  const positionNames = useMemo(() => new Map(positions.map(item => [item.id, item.name])), [positions]);
  const teamNames = useMemo(() => new Map(teams.map(item => [item.id, item.name])), [teams]);

  const load = useCallback(async (requestedPage = page, requestedPageSize = pageSize) => {
    setLoading(true); setError(undefined);
    try {
      const response = await masterDataApi.employees.list({ page: requestedPage, pageSize: requestedPageSize, keyword: keyword || undefined, status, organizationId, teamId });
      setEmployees(response.data.list); setTotal(response.data.pagination.total);
      const organizationIds = [...new Set(response.data.list.flatMap(item => item.primaryAssignment?.organizationId ?? []))];
      const positionResponses = canReadPositions
        ? await Promise.allSettled(organizationIds.map(id => masterDataApi.positions.list({ organizationId: id })))
        : [];
      setPositions(current => {
        const merged = new Map(current.map(item => [item.id, item]));
        positionResponses
          .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof masterDataApi.positions.list>>> => item.status === 'fulfilled')
          .flatMap(item => item.value.data)
          .forEach(item => merged.set(item.id, item));
        return [...merged.values()];
      });
    } catch (cause) { setError(errorStatus(cause) === 403 ? '您没有权限查看人员主数据' : '人员数据加载失败'); }
    finally { setLoading(false); }
  }, [canReadPositions, keyword, organizationId, page, pageSize, status, teamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void (async () => {
      setLoading(true); setError(undefined);
      try {
        const [orgResult, teamResult, employeeResult] = await Promise.allSettled([
          canReadOrganizations ? masterDataApi.organizations.options() : Promise.resolve(undefined),
          canReadTeams ? masterDataApi.professionalTeams.list({ page: 1, pageSize: 100 }) : Promise.resolve(undefined),
          masterDataApi.employees.list({ page: 1, pageSize: 20 }),
        ]);
        if (employeeResult.status === 'rejected') throw employeeResult.reason;
        if (orgResult.status === 'fulfilled' && orgResult.value) setOrganizations(orgResult.value.data);
        if (teamResult.status === 'fulfilled' && teamResult.value) setTeams(teamResult.value.data.list);
        const employeeResponse = employeeResult.value;
        setEmployees(employeeResponse.data.list); setTotal(employeeResponse.data.pagination.total);
        const organizationIds = [...new Set(employeeResponse.data.list.flatMap(item => item.primaryAssignment?.organizationId ?? []))];
        const positionResults = canReadPositions
          ? await Promise.allSettled(organizationIds.map(id => masterDataApi.positions.list({ organizationId: id })))
          : [];
        setPositions(positionResults
          .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof masterDataApi.positions.list>>> => item.status === 'fulfilled')
          .flatMap(item => item.value.data));
      } catch (cause) { setError(errorStatus(cause) === 403 ? '您没有权限查看人员主数据' : '人员数据加载失败'); }
      finally { setLoading(false); }
    })(), 0);
    return () => window.clearTimeout(timer);
  }, [canReadOrganizations, canReadPositions, canReadTeams]);

  async function positionsFor(organization: string, form = employeeForm) {
    form.setFieldValue('primaryPositionId', undefined);
    assignmentForm.setFieldValue('positionId', undefined);
    try { const response = await masterDataApi.positions.list({ organizationId: organization, status: 'ENABLED' }); setFormPositions(response.data); }
    catch (error) { setFormPositions([]); showRequestError(error, '岗位选项加载失败'); }
  }

  async function openDetail(employee: EmployeeListItem) {
    try {
      const [employeeResult, userResult] = await Promise.allSettled([
        masterDataApi.employees.detail(employee.id),
        canReadUsers ? userApi.list({ page: 1, pageSize: 100, status: 'ENABLED' }) : Promise.resolve(undefined),
      ]);
      if (employeeResult.status === 'rejected') throw employeeResult.reason;
      setDetail(employeeResult.value.data);
      setUsers(userResult.status === 'fulfilled' && userResult.value
        ? userResult.value.data.list.filter(user => !user.employeeId || user.employeeId === employee.id).map(user => ({ value: user.id, label: user.username }))
        : []);
    } catch (error) { showRequestError(error, '员工详情加载失败'); }
  }
  async function refreshDetail() { if (!detail) return; const response = await masterDataApi.employees.detail(detail.id); setDetail(response.data); await load(); }

  async function removeEmployee() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await masterDataApi.employees.remove(deleteTarget.id, { version: deleteTarget.version, confirmed: true });
      message.success('员工档案已删除，工号可供新员工使用');
      if (detail?.id === deleteTarget.id) setDetail(null);
      setDeleteTarget(null);
      const nextPage = employees.length === 1 && page > 1 ? page - 1 : page;
      setPage(nextPage); await load(nextPage);
    } catch (error) { showRequestError(error, '员工档案删除失败'); }
    finally { setDeleting(false); }
  }
  async function submitCreate() {
    const values = await validateForm(employeeForm); if (!values) return; setSubmitting(true);
    try { await masterDataApi.employees.create(values); message.success('员工已创建'); setCreateOpen(false); employeeForm.resetFields(); await load(1); }
    catch (error) { showRequestError(error, '创建未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submitEdit() {
    if (!detail) return; const values = await validateForm(employeeForm); if (!values) return; setSubmitting(true);
    try { await masterDataApi.employees.update(detail.id, { name: values.name, phone: values.phone, email: values.email, idCard: values.idCard, licenseNo: values.licenseNo, employeeType: values.employeeType, professionalDirections: values.professionalDirections, version: detail.version } satisfies UpdateEmployeeInput); message.success('档案已更新'); setEditOpen(false); await refreshDetail(); }
    catch (error) { showRequestError(error, '更新未完成，当前输入已保留'); }
    finally { setSubmitting(false); }
  }
  async function submitFormalize() { if (!detail) return; const values = await validateForm(formalForm); if (!values) return; setSubmitting(true); try { await masterDataApi.employees.formalize(detail.id, { ...values, version: detail.version }); setFormalOpen(false); await refreshDetail(); } catch (error) { showRequestError(error, '转正未完成'); } finally { setSubmitting(false); } }
  async function submitLeave() { if (!detail || !handoverConfirmed) return; const values = await validateForm(leaveForm); if (!values) return; setSubmitting(true); try { await masterDataApi.employees.leave(detail.id, { ...values, handoverConfirmed: true, version: detail.version }); setLeaveOpen(false); await refreshDetail(); } catch (error) { showRequestError(error, '离职未完成，请检查保护条件'); } finally { setSubmitting(false); } }
  async function submitAssignment(values: AssignmentValues) { if (!detail || !assignmentMode) return; setSubmitting(true); try { if (assignmentMode === 'transfer') await masterDataApi.employees.transferPrimary(detail.id, { organizationId: values.organizationId, positionId: values.positionId, employeeVersion: detail.version }); else await masterDataApi.employees.addAssignment(detail.id, { organizationId: values.organizationId, positionId: values.positionId, assignmentType: values.assignmentType === 'ACTING' ? 'ACTING' : 'SECONDARY' }); setAssignmentMode(undefined); await refreshDetail(); } catch (error) { showRequestError(error, '任职变更未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function endAssignment(assignment: EmployeeAssignment) { if (!detail) return; try { await masterDataApi.employees.endAssignment(detail.id, assignment.id, { version: assignment.version }); await refreshDetail(); } catch (error) { showRequestError(error, '结束任职失败'); } }
  async function bindAccount() { if (!detail || !selectedUserId) return; try { await masterDataApi.employees.bindAccount(detail.id, { userId: selectedUserId, employeeVersion: detail.version }); setSelectedUserId(undefined); await refreshDetail(); } catch (error) { showRequestError(error, '账号绑定失败'); } }
  async function unbindAccount() { if (!detail) return; try { await masterDataApi.employees.unbindAccount(detail.id, { version: detail.version }); await refreshDetail(); } catch (error) { showRequestError(error, '解除绑定失败'); } }

  return <section className="md-page"><header className="md-toolbar"><div><h1>员工与任职</h1>{canReadApproval && <Space><a href="/approval-ledger?target=LEAVE">请假台账</a><a href="/approval-ledger?target=TRANSFER">调动台账</a></Space>}<p>员工档案与任职关系分离管理，所有组织归属以生效任职为准。</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => { employeeForm.resetFields(); setFormPositions([]); setCreateOpen(true); }}>新增员工</Button></header>
    <div className="md-filter-bar"><Input placeholder="姓名或工号" value={keyword} onChange={event => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); void load(1); }} prefix={<SearchOutlined />} /><Select aria-label="员工状态" allowClear placeholder="状态" value={status} options={statusOptions} onChange={setStatus} /><Select aria-label="组织筛选" allowClear showSearch optionFilterProp="label" placeholder="组织" value={organizationId} options={organizationOptions} onChange={setOrganizationId} /><Select aria-label="团队筛选" allowClear showSearch placeholder="专业团队" value={teamId} options={teams.map(item => ({ value: item.id, label: item.name }))} onChange={setTeamId} /><Button type="primary" onClick={() => { setPage(1); void load(1); }}>查询</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></div>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Table rowKey="id" loading={loading} dataSource={employees} scroll={{ x: 1060 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); void load(nextPage, nextSize); } }} columns={[
      { title: '工号', dataIndex: 'employeeNo', width: 120 }, { title: '姓名', dataIndex: 'name', width: 120 }, { title: '状态', dataIndex: 'status', width: 90, render: (value: EmployeeStatus) => <Tag>{statusText[value]}</Tag> },
      { title: '主组织', dataIndex: 'primaryAssignment', width: 300, render: (value: EmployeeListItem['primaryAssignment']) => { const path = value ? organizationNames.get(value.organizationId) || value.organizationId : '-'; return <span title={path}>{path}</span>; } },
      { title: '主岗位', dataIndex: 'primaryAssignment', width: 120, render: (value: EmployeeListItem['primaryAssignment']) => value ? positionNames.get(value.positionId) || value.positionId : '-' },
      { title: '专业团队', dataIndex: 'activeProfessionalTeamIds', width: 160, render: (ids: string[]) => ids.map(id => teamNames.get(id) || id).join('、') || '-' },
      { title: '人员类型', dataIndex: 'employeeType', width: 120, render: employeeTypeLabel }, { title: '入职日期', dataIndex: 'entryDate', width: 130, render: (value: string) => value.slice(0, 10) },
      { title: '操作', width: canDelete ? 160 : 84, render: (_: unknown, row: EmployeeListItem) => <span className="md-row-actions"><Button type="text" icon={<EyeOutlined />} aria-label={`查看${row.name}`} onClick={() => void openDetail(row)} />{canDelete && <Button danger aria-label={`删除${row.name}`} onClick={() => setDeleteTarget(row)}>删除</Button>}</span> },
    ]} />
    <Modal title="删除员工档案" open={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)} onOk={() => void removeEmployee()} confirmLoading={deleting} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}>
      <p>确认删除“{deleteTarget?.name}”（工号：{deleteTarget?.employeeNo}）的档案？</p>
      <p>档案将从员工列表移除；当前任职会结束，绑定账号会停用，工号会释放。历史业务记录仍保留并关联原员工。</p>
      <p>请先完成未结业务、负责人职责和下属的移交。</p>
    </Modal>
    <Modal title="新增员工" open={createOpen} confirmLoading={submitting} onCancel={() => setCreateOpen(false)} onOk={() => void submitCreate()} width={680} destroyOnHidden><EmployeeForm form={employeeForm} organizations={organizationOptions} positions={positionOptions} onOrganizationChange={id => void positionsFor(id)} /></Modal>
    <Modal title="编辑基础档案" open={editOpen} confirmLoading={submitting} onCancel={() => setEditOpen(false)} onOk={() => void submitEdit()} width={680} destroyOnHidden><EmployeeForm form={employeeForm} editing organizations={organizationOptions} positions={[]} onOrganizationChange={() => undefined} /></Modal>
    <Modal title="员工转正" open={formalOpen} confirmLoading={submitting} onCancel={() => setFormalOpen(false)} onOk={() => void submitFormalize()} destroyOnHidden><Form form={formalForm} layout="vertical"><Form.Item name="formalDate" label="转正日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Form></Modal>
    <Modal title="办理离职" open={leaveOpen} confirmLoading={submitting} okButtonProps={{ disabled: !handoverConfirmed }} onCancel={() => setLeaveOpen(false)} onOk={() => void submitLeave()} destroyOnHidden><Form form={leaveForm} layout="vertical"><Form.Item name="leaveDate" label="离职日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Form><Checkbox checked={handoverConfirmed} onChange={event => setHandoverConfirmed(event.target.checked)}>确认交接完成后才能提交离职</Checkbox></Modal>
    <AssignmentDialog open={Boolean(assignmentMode)} title={assignmentMode === 'transfer' ? '调动主职' : '新增兼任'} form={assignmentForm} organizations={organizationOptions} positions={positionOptions} allowType={assignmentMode === 'add'} submitting={submitting} onOrganizationChange={id => void positionsFor(id, employeeForm)} onCancel={() => setAssignmentMode(undefined)} onSubmit={values => void submitAssignment(values)} />
    <EmployeeDetailDrawer employee={detail} open={Boolean(detail)} organizations={organizationNames} positions={positionNames} teams={teamNames} users={users} selectedUserId={selectedUserId} onClose={() => setDetail(null)} onEdit={() => { if (!detail) return; employeeForm.setFieldsValue(detail); setEditOpen(true); }} onFormalize={() => { formalForm.resetFields(); setFormalOpen(true); }} onLeave={() => { leaveForm.resetFields(); setHandoverConfirmed(false); setLeaveOpen(true); }} onTransfer={() => { assignmentForm.resetFields(); setFormPositions([]); setAssignmentMode('transfer'); }} onAddAssignment={() => { assignmentForm.resetFields(); setFormPositions([]); setAssignmentMode('add'); }} onEndAssignment={assignment => void endAssignment(assignment)} onSelectUser={setSelectedUserId} onBind={() => void bindAccount()} onUnbind={() => void unbindAccount()} />
  </section>;
}
