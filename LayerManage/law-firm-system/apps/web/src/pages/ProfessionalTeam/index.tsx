import { categoryLabel } from '@/locales/business-labels';
import { useAuthStore } from '@/stores/authStore';
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
import type { CreateProfessionalTeamInput, MasterDataStatus, ProfessionalTeam, ProfessionalTeamDetail, TeamMemberRole, UpdateProfessionalTeamInput } from '@/features/master-data/types';
import '@/features/master-data/master-data.css';

type TeamValues = CreateProfessionalTeamInput;
type MemberValues = { employeeId: string; memberRole: TeamMemberRole };

export default function ProfessionalTeamPage() {
  const canCreate = useAuthStore(state => state.hasPermission('professional_team.create'));
  const canEdit = useAuthStore(state => state.hasPermission('professional_team.update'));
  const canChangeLead = useAuthStore(state => state.hasPermission('professional_team.lead.manage'));
  const canDelete = useAuthStore(state => state.hasPermission('professional_team.status.manage'));
  const canRemoveMember = useAuthStore(state => state.hasPermission('professional_team.member.manage'));
  const [deleteTarget, setDeleteTarget] = useState<ProfessionalTeam | null>(null);
  const [teams, setTeams] = useState<ProfessionalTeam[]>([]);
  const [detail, setDetail] = useState<ProfessionalTeamDetail | null>(null);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string; employeeNo: string }[]>([]);
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
  const organizationOptions = useMemo(() => organizations.map(item => ({ value: item.id, label: item.name })), [organizations]);
  const organizationNames = useMemo(() => new Map(organizationOptions.map(item => [item.value, item.label])), [organizationOptions]);
  const employeeOptions: SelectOption[] = useMemo(() => employees.map(item => ({ value: item.id, label: `${item.name} · ${item.employeeNo}` })), [employees]);

  const load = useCallback(async (requestedPage = page, requestedPageSize = pageSize) => {
    setLoading(true); setError(false);
    try { const response = await masterDataApi.professionalTeams.list({ page: requestedPage, pageSize: requestedPageSize, keyword: keyword || undefined, status }); setTeams(response.data.list); setTotal(response.data.pagination.total); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [keyword, page, pageSize, status]);

  useEffect(() => { const timer = window.setTimeout(() => void (async () => {
    setLoading(true); setError(false);
    try {
      const response = await masterDataApi.professionalTeams.list({ page: 1, pageSize: 20 });
      setTeams(response.data.list); setTotal(response.data.pagination.total);
    } catch { setError(true); }
    finally { setLoading(false); }
  })(), 0); return () => window.clearTimeout(timer); }, []);

  async function openDetail(team: ProfessionalTeam) { try { const response = await masterDataApi.professionalTeams.detail(team.id); setDetail(response.data); } catch (error) { showRequestError(error, '团队详情加载失败'); } }
  async function refreshDetail() { if (!detail) return; const response = await masterDataApi.professionalTeams.detail(detail.id); setDetail(response.data); await load(); }
  async function openTeamForm(edit: boolean) {
    try {
      const response = await masterDataApi.professionalTeams.organizationOptions(edit ? detail?.id : undefined);
      setOrganizations(response.data); setEditing(edit); teamForm.resetFields();
      if (edit && detail) teamForm.setFieldsValue(detail);
      setFormOpen(true);
    } catch (error) { showRequestError(error, '团队选项加载失败'); }
  }
  async function openMember(mode: 'add' | 'lead') {
    if (!detail) return;
    try {
      const response = await masterDataApi.professionalTeams.memberOptions(detail.id, undefined, mode === 'lead');
      setEmployees(response.data); memberForm.resetFields(); setMemberMode(mode);
    } catch (error) { showRequestError(error, '员工选项加载失败'); }
  }
  async function submitTeam() { const values = await validateForm(teamForm); if (!values) return; setSubmitting(true); try { if (editing && detail) await masterDataApi.professionalTeams.update(detail.id, { name: values.name, categoryCode: values.categoryCode, homeOrganizationId: values.homeOrganizationId, description: values.description, version: detail.version } satisfies UpdateProfessionalTeamInput); else await masterDataApi.professionalTeams.create(values); message.success('专业团队已保存'); setFormOpen(false); if (editing) await refreshDetail(); else await load(1); } catch (error) { showRequestError(error, '保存未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function toggleTeam(team: ProfessionalTeamDetail) { try { if (team.status === 'ENABLED') await masterDataApi.professionalTeams.disable(team.id, { version: team.version }); else await masterDataApi.professionalTeams.enable(team.id, { version: team.version }); await refreshDetail(); } catch (error) { showRequestError(error, team.activeMemberCount > 0 ? '团队仍有生效成员，不能停用' : '团队状态更新失败'); } }
  async function submitMember(values: MemberValues) { if (!detail || !memberMode) return; setSubmitting(true); try { if (memberMode === 'lead') await masterDataApi.professionalTeams.replaceLead(detail.id, { employeeId: values.employeeId, teamVersion: detail.version }); else await masterDataApi.professionalTeams.addMember(detail.id, { employeeId: values.employeeId, memberRole: values.memberRole }); setMemberMode(undefined); if (memberMode === 'lead') { setDetail(null); await load(); } else await refreshDetail(); } catch (error) { showRequestError(error, '成员变更未完成，当前输入已保留'); } finally { setSubmitting(false); } }
  async function endMember(memberId: string, version: number) { if (!detail) return; try { await masterDataApi.professionalTeams.endMember(detail.id, memberId, { version }); setDetail(null); await load(); } catch (error) { showRequestError(error, '结束成员关系失败'); } }
  async function searchEmployees(keyword: string) { try { if (!detail) return; const response = await masterDataApi.professionalTeams.memberOptions(detail.id, keyword, memberMode === 'lead'); setEmployees(response.data); } catch (error) { showRequestError(error, '员工选项加载失败'); } }
  async function removeTeam() {
    if (!deleteTarget) return;
    setSubmitting(true);
    try { await masterDataApi.professionalTeams.remove(deleteTarget.id, { version: deleteTarget.version }); if (detail?.id === deleteTarget.id) setDetail(null); setDeleteTarget(null); await load(); message.success('团队已删除'); }
    catch (error) { showRequestError(error, '删除团队失败'); }
    finally { setSubmitting(false); }
  }

  return <section className="md-page"><header className="md-toolbar"><div><h1>专业团队</h1><p>团队分类开放扩展，成员可跨分所任职，历史关系持续保留。</p></div><>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => void openTeamForm(false)}>新增团队</Button>}</></header>
    <div className="md-filter-bar"><Input placeholder="团队名称或编码" value={keyword} onChange={event => setKeyword(event.target.value)} onPressEnter={() => void load(1)} /><Select aria-label="团队状态" allowClear placeholder="状态" value={status} options={[{ value: 'ENABLED', label: '启用' }, { value: 'DISABLED', label: '停用' }]} onChange={setStatus} /><Button type="primary" onClick={() => { setPage(1); void load(1); }}>查询</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></div>
    {error && <Alert type="error" showIcon title="专业团队数据加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <div className="md-team-layout"><div className="md-team-list"><Table rowKey="id" size="small" loading={loading} dataSource={teams} scroll={{ x: 560 }} pagination={{ current: page, pageSize, total, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); void load(nextPage, nextSize); } }} locale={{ emptyText: <div className="md-empty"><span>暂无可管理的专业团队</span><Button onClick={() => void load()}>重试</Button></div> }} columns={[
      { title: '团队', dataIndex: 'name' }, { title: '分类', dataIndex: 'categoryCode', render: (value: string) => <span title={`分类编码：${value}`}>{categoryLabel(value)}</span> }, { title: '成员', dataIndex: 'activeMemberCount' }, { title: '状态', dataIndex: 'status', render: (value: MasterDataStatus) => <Tag>{value === 'ENABLED' ? '启用' : '停用'}</Tag> },
      { title: '操作', width: 140, render: (_: unknown, row: ProfessionalTeam) => <Space><Button type="text" icon={<EyeOutlined />} aria-label={`查看${row.name}`} onClick={() => void openDetail(row)} />{canDelete && <Button danger onClick={() => setDeleteTarget(row)}>删除</Button>}</Space> },
    ]} /></div>
      <aside className="md-team-detail">{detail ? <><div className="md-detail-heading"><div><h2>{detail.name}</h2><p>{detail.code} · {categoryLabel(detail.categoryCode)} · {detail.homeOrganizationName || organizationNames.get(detail.homeOrganizationId) || '—'}</p></div><Space wrap><>{canEdit && <Button onClick={() => void openTeamForm(true)}>编辑</Button>}</>{canDelete && <Popconfirm title={detail.status === 'ENABLED' ? '确认停用团队？' : '确认启用团队？'} onConfirm={() => void toggleTeam(detail)}><Button danger={detail.status === 'ENABLED'}>{detail.status === 'ENABLED' ? '停用' : '启用'}</Button></Popconfirm>}</Space></div>
        <div className="md-section-actions">{canRemoveMember && <Button type="primary" onClick={() => void openMember('add')}>添加成员</Button>}{canChangeLead && <Button onClick={() => void openMember('lead')}>更换负责人</Button>}</div>
        <Table rowKey="id" size="small" pagination={false} dataSource={detail.members} columns={[
          { title: '成员', render: (_: unknown, row: ProfessionalTeamDetail['members'][number]) => row.employeeName ? `${row.employeeName}${row.employeeNo ? ' · ' + row.employeeNo : ''}` : '员工信息暂不可用' },
          { title: '角色', dataIndex: 'memberRole', render: (role: TeamMemberRole) => role === 'LEAD' ? '负责人' : role },
          { title: '期间', render: (_: unknown, row: ProfessionalTeamDetail['members'][number]) => row.endedAt ? `${row.startedAt.slice(0, 10)} 至 ${row.endedAt.slice(0, 10)}` : `${row.startedAt.slice(0, 10)} 至今` },
          { title: '操作', render: (_: unknown, row: ProfessionalTeamDetail['members'][number]) => !row.endedAt && canRemoveMember ? <Popconfirm title="确认删除该成员？历史成员关系将保留。" onConfirm={() => void endMember(row.id, row.version)}><Button size="small" danger>删除成员</Button></Popconfirm> : null },
        ]} />
      </> : <div className="md-empty"><span>请选择团队查看详情</span></div>}</aside></div>
    <Modal title={editing ? '编辑专业团队' : '新增专业团队'} open={formOpen} confirmLoading={submitting} onCancel={() => setFormOpen(false)} onOk={() => void submitTeam()} destroyOnHidden><ProfessionalTeamForm form={teamForm} editing={editing} organizations={organizationOptions} /></Modal>
    <TeamMemberDialog open={Boolean(memberMode)} title={memberMode === 'lead' ? '更换负责人' : '添加成员'} form={memberForm} employees={employeeOptions} replaceLead={memberMode === 'lead'} submitting={submitting} onSearch={keyword => void searchEmployees(keyword)} onCancel={() => setMemberMode(undefined)} onSubmit={values => void submitMember(values)} />
    <Modal title="删除专业团队" open={Boolean(deleteTarget)} confirmLoading={submitting} onCancel={() => setDeleteTarget(null)} onOk={() => void removeTeam()} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}><p>确认删除“{deleteTarget?.name}”？将结束全部成员关系，保留历史记录。</p></Modal>
  </section>;
}
