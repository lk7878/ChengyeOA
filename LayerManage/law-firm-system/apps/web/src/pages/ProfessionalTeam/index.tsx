import { categoryLabel } from '@/locales/business-labels';
import Table from '@/components/ResizableTable';
import { validateForm } from '@/features/master-data/form-rules';
import { showRequestError } from '@/api/errors';
import { EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Popconfirm, Select, Space, Tag, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { masterDataApi } from '@/features/master-data/api';
import ProfessionalTeamForm from '@/features/master-data/components/ProfessionalTeamForm';
import TeamMemberDialog from '@/features/master-data/components/TeamMemberDialog';
import type { SelectOption } from '@/features/master-data/components/EmployeeForm';
import type { CreateProfessionalTeamInput, EmployeeListItem, MasterDataStatus, OrganizationNode, ProfessionalTeam, ProfessionalTeamDetail, TeamMemberRole, UpdateProfessionalTeamInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';

type TeamValues = CreateProfessionalTeamInput;
type MemberValues = { employeeId: string; memberRole: TeamMemberRole };
function flatten(nodes: OrganizationNode[]): OrganizationNode[] { return nodes.flatMap(node => [node, ...flatten(node.children)]); }

export default function ProfessionalTeamPage() {
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const [detail, setDetail] = useState<ProfessionalTeamDetail | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationNode[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<MasterDataStatus>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [memberMode, setMemberMode] = useState<'add' | 'lead'>();
  const [submitting, setSubmitting] = useState(false);
  const [teamForm] = Form.useForm<TeamValues>();
  const [memberForm] = Form.useForm<MemberValues>();
  const organizationOptions = useMemo(() => flatten(organizations).map(item => ({ value: item.id, label: item.name })), [organizations]);
  const organizationNames = useMemo(() => new Map(organizationOptions.map(item => [item.value, item.label])), [organizationOptions]);
  const employeeOptions: SelectOption[] = useMemo(() => employees.filter(item => item.status !== 'LEAVED').map(item => ({ value: item.id, label: `${item.name} · ${item.employeeNo}` })), [employees]);
  const employeeNames = useMemo(() => new Map(employees.map(item => [item.id, item.name])), [employees]);

  const load = useCallback(async (requestedPage = page, requestedPageSize = pageSize) => {
    setLoading(true); setError(false);
    try { const response = await masterDataApi.professionalTeams.list({ page: requestedPage, pageSize: requestedPageSize, keyword: keyword || undefined, status }); setTeams(response.data.list); setTotal(response.data.pagination.total); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [keyword, page, pageSize, status]);

  useEffect(() => { const timer = window.setTimeout(() => void (async () => {
    setLoading(true); setError(false);
    try {
      const [orgResponse, employeeResponse, teamResponse] = await Promise.all([masterDataApi.organizations.options('ENABLED'), masterDataApi.employees.list({ page: 1, pageSize: 100 }), masterDataApi.professionalTeams.list({ page: 1, pageSize: 20 })]);
      setOrganizations(orgResponse.data); setEmployees(employeeResponse.data.list); setTeams(teamResponse.data.list); setTotal(teamResponse.data.pagination.total);
    } catch { setError(true); }
    finally { setLoading(false); }
  })(), 0); return () => window.clearTimeout(timer); }, []);

  async function openDetail(team: ProfessionalTeam) { try { const response = await masterDataApi.professionalTeams.detail(team.id); setDetail(response.data); } catch (error) { showRequestError(error, '团队详情加载失败'); } }
  async function refreshDetail() { if (!detail) return; const response = await masterDataApi.professionalTeams.detail(detail.id); setDetail(response.data); await load(); }
  function openCreate() { setEditing(false); teamForm.resetFields(); setFormOpen(true); }
  function openEdit() { if (!detail) return; setEditing(true); teamForm.setFieldsValue(detail); setFormOpen(true); }
  async function submitTeam() { const values = await validateForm(teamForm); if (!values) return; setSubmitting(true); try { if (editing && detail) await masterDataApi.professionalTeams.update(detail.id, { name: values.name, categoryCode: values.categoryCode, homeOrganizationId: values.homeOrganizationId, description: values.description, version: detail.version } satisfies UpdateProfessionalTeamInput); else await masterDataApi.professionalTeams.create(values); message.success('专业团队已保存'); setFormOpen(false); if (editing) await refreshDetail(); else await load(1); } catch (error) { showRequestError(error, '保存未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function toggleTeam(team: ProfessionalTeamDetail) { try { if (team.status === 'ENABLED') await masterDataApi.professionalTeams.disable(team.id, { version: team.version }); else await masterDataApi.professionalTeams.enable(team.id, { version: team.version }); await refreshDetail(); } catch (error) { showRequestError(error, team.activeMemberCount > 0 ? '团队仍有生效成员，不能停用' : '团队状态更新失败'); } }
  async function submitMember(values: MemberValues) { if (!detail || !memberMode) return; setSubmitting(true); try { if (memberMode === 'lead') await masterDataApi.professionalTeams.replaceLead(detail.id, { employeeId: values.employeeId, teamVersion: detail.version }); else await masterDataApi.professionalTeams.addMember(detail.id, { employeeId: values.employeeId, memberRole: values.memberRole }); setMemberMode(undefined); await refreshDetail(); } catch (error) { showRequestError(error, '成员变更未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function endMember(memberId: string, version: number) { if (!detail) return; try { await masterDataApi.professionalTeams.endMember(detail.id, memberId, { version }); await refreshDetail(); } catch (error) { showRequestError(error, '结束成员关系失败'); } }
  async function searchEmployees(keyword: string) { try { const response = await masterDataApi.employees.list({ page: 1, pageSize: 100, keyword: keyword || undefined }); setEmployees(response.data.list); } catch (error) { showRequestError(error, '员工选项加载失败'); } }

  return <section className="md-page"><header className="md-toolbar"><div><h1>专业团队</h1><p>团队分类开放扩展，成员可跨分所任职，历史关系持续保留。</p></div><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增团队</Button></header>
    <div className="md-filter-bar"><Input placeholder="团队名称或编码" value={keyword} onChange={event => setKeyword(event.target.value)} onPressEnter={() => void load(1)} /><Select aria-label="团队状态" allowClear placeholder="状态" value={status} options={[{ value: 'ENABLED', label: '启用' }, { value: 'DISABLED', label: '停用' }]} onChange={setStatus} /><Button type="primary" onClick={() => { setPage(1); void load(1); }}>查询</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></div>
    {error && <Alert type="error" showIcon title="专业团队数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <div className="md-team-layout"><div className="md-team-list"><Table rowKey="id" size="small" loading={loading} dataSource={teams} scroll={{ x: 560 }} pagination={{ current: page, pageSize, total, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); void load(nextPage, nextSize); } }} locale={{ emptyText: <div className="md-empty"><span>暂无专业团队</span><Button onClick={() => void load()}>重试</Button></div> }} columns={[
      { title: '团队', dataIndex: 'name' }, { title: '分类', dataIndex: 'categoryCode', render: (value: string) => <span title={`分类编码：${value}`}>{categoryLabel(value)}</span> }, { title: '成员', dataIndex: 'activeMemberCount' }, { title: '状态', dataIndex: 'status', render: (value: MasterDataStatus) => <Tag>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
      { title: '操作', width: 70, render: (_: unknown, row: ProfessionalTeam) => <Button type="text" icon={<EyeOutlined />} aria-label={`查看${row.name}`} onClick={() => void openDetail(row)} /> },
    ]} /></div>
      <aside className="md-team-detail">{detail ? <><div className="md-detail-heading"><div><h2>{detail.name}</h2><p>{detail.code} · {categoryLabel(detail.categoryCode)} · {organizationNames.get(detail.homeOrganizationId) || detail.homeOrganizationId}</p></div><Space wrap><Button onClick={openEdit}>编辑</Button><Popconfirm title={detail.status === 'ENABLED' ? '确认停用团队？' : '确认启用团队？'} onConfirm={() => void toggleTeam(detail)}><Button danger={detail.status === 'ENABLED'}>{detail.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm></Space></div>
        <div className="md-section-actions"><Button type="primary" onClick={() => { memberForm.resetFields(); setMemberMode('add'); }}>添加成员</Button><Button onClick={() => { memberForm.resetFields(); setMemberMode('lead'); }}>更换负责人</Button></div>
        <Table rowKey="id" size="small" pagination={false} dataSource={detail.members} columns={[
          { title: '成员', dataIndex: 'employeeId', render: (id: string) => employeeNames.get(id) || id },
          { title: '角色', dataIndex: 'memberRole', render: (role: TeamMemberRole) => role === 'LEAD' ? '负责人' : role },
          { title: '期间', render: (_: unknown, row: ProfessionalTeamDetail['members'][number]) => row.endedAt ? `${row.startedAt.slice(0, 10)} 至 ${row.endedAt.slice(0, 10)}` : `${row.startedAt.slice(0, 10)} 至今` },
          { title: '操作', render: (_: unknown, row: ProfessionalTeamDetail['members'][number]) => !row.endedAt && row.memberRole !== 'LEAD' ? <Popconfirm title="确认结束该成员关系？" onConfirm={() => void endMember(row.id, row.version)}><Button size="small">结束</Button></Popconfirm> : null },
        ]} />
      </> : <div className="md-empty"><span>请选择团队查看详情</span></div>}</aside></div>
    <Modal title={editing ? '编辑专业团队' : '新增专业团队'} open={formOpen} confirmLoading={submitting} onCancel={() => setFormOpen(false)} onOk={() => void submitTeam()} destroyOnHidden><ProfessionalTeamForm form={teamForm} editing={editing} organizations={organizationOptions} /></Modal>
    <TeamMemberDialog open={Boolean(memberMode)} title={memberMode === 'lead' ? '更换负责人' : '添加成员'} form={memberForm} employees={employeeOptions} replaceLead={memberMode === 'lead'} submitting={submitting} onSearch={keyword => void searchEmployees(keyword)} onCancel={() => setMemberMode(undefined)} onSubmit={values => void submitMember(values)} />
  </section>;
}
