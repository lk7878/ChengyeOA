import { Alert, Form, Input, Modal, Select } from 'antd';
import { useEffect, useState } from 'react';
import { showRequestError } from '@/api/errors';
import { masterDataApi } from '../api';
import OrganizationSortSelect from './OrganizationSortSelect';
import type { CreateOrganizationInput, OrganizationManager, OrganizationNode, UpdateOrganizationInput } from '../types';
import { allowedChildTypes, CODE_HELP, codeRules, normalizeCode, textRules } from '../form-rules';
import { flattenOrganizations, nextOrganizationSort, organizationTypeLabels } from '../organization-utils';

type Values = CreateOrganizationInput & { sourceId?: string };
export default function OrganizationForm({ open, parent, editing, copySource = null, tree = [], submitting, onCancel, onSubmit }: {
  open: boolean; parent: OrganizationNode | null; editing: OrganizationNode | null;
  copySource?: OrganizationNode | null; tree?: OrganizationNode[]; submitting: boolean;
  onCancel: () => void;
  onSubmit: (value: CreateOrganizationInput | UpdateOrganizationInput, source?: OrganizationNode) => Promise<void>;
}) {
  const [form] = Form.useForm<Values>();
  const [managers, setManagers] = useState<OrganizationManager[]>([]);
  const [keyword, setKeyword] = useState('');
  const [managerLoading, setManagerLoading] = useState(false);
  const all = flattenOrganizations(tree);
  const suggestedSort = nextOrganizationSort(all);
  const parentId = Form.useWatch('parentId', { form, preserve: true });
  const sourceId = Form.useWatch('sourceId', { form, preserve: true });
  const destination = all.find(node => node.id === parentId) ?? parent;
  const availableTypes = destination ? allowedChildTypes(destination.type) : [];
  useEffect(() => {
    if (!open) return;
    const initial = editing ?? copySource;
    const types = parent ? allowedChildTypes(parent.type) : [];
    form.setFieldsValue({
      code: editing?.code ?? '', name: initial?.name ?? '',
      type: (initial?.type ?? (types.includes('DEPARTMENT') ? 'DEPARTMENT' : types[0])) as Values['type'],
      sort: editing?.sort ?? suggestedSort, parentId: parent?.id,
      managerEmployeeId: editing?.managerEmployeeId ?? null, sourceId: copySource?.id,
    });
  }, [editing, copySource, form, open, parent, suggestedSort]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setManagerLoading(true);
      try { const response = await masterDataApi.organizations.managerOptions(keyword); if (!cancelled) setManagers(response.data); }
      catch (error) { if (!cancelled) showRequestError(error, '负责人候选加载失败，请重新搜索'); }
      finally { if (!cancelled) setManagerLoading(false); }
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, keyword]);
  const managerOptions = [...new Map([...(editing?.manager ? [editing.manager] : []), ...managers].map(item => [item.id, item])).values()];

  return <Modal title={editing ? '编辑组织' : copySource ? '复制组织' : '新增下级组织'} open={open} confirmLoading={submitting}
    okText="保存" cancelText="取消" cancelButtonProps={{ disabled: submitting }} closable={!submitting} mask={{ closable: !submitting }}
    onCancel={onCancel} onOk={() => form.submit()} destroyOnHidden>
    <Form form={form} layout="vertical" disabled={submitting} onFinish={value => {
      const fields = { name: value.name, sort: value.sort, managerEmployeeId: value.managerEmployeeId ?? null };
      return onSubmit(editing ? { ...fields, version: editing.version } : {
        ...fields, code: value.code, type: value.type, parentId: value.parentId,
      }, all.find(node => node.id === value.sourceId));
    }}>
      {!editing && <>
        <Form.Item name="parentId" label="上级组织" rules={[{ required: true, message: '请选择上级组织' }]}>
          <Select showSearch optionFilterProp="label" options={(all.length ? all : parent ? [parent] : []).filter(node => node.status === 'ENABLED' && allowedChildTypes(node.type).length)
            .map(node => ({ value: node.id, label: node.name + '（' + node.code + '）' }))} onChange={id => {
              const target = all.find(node => node.id === id) ?? parent;
              const types = target ? allowedChildTypes(target.type) : [];
              if (!types.includes(form.getFieldValue('type'))) form.setFieldValue('type', undefined);
            }} />
        </Form.Item>
        <Form.Item name="sourceId" label="复制相似组织（可选）">
          <Select allowClear showSearch optionFilterProp="label" placeholder="选择模板，复制下级组织和岗位结构"
            options={all.filter(node => node.type !== 'FIRM').map(node => ({ value: node.id, label: node.name + '（' + node.code + '）' }))}
            onChange={id => {
              const source = all.find(node => node.id === id);
              if (source) form.setFieldsValue({ name: source.name, type: availableTypes.includes(source.type as Values['type']) ? source.type as Values['type'] : undefined, managerEmployeeId: null });
            }} />
        </Form.Item>
        {sourceId && <Alert type="info" showIcon title="将同时复制全部下级组织和各级岗位。请填写新编码，可修改名称；员工任职、权限和原负责人不随结构复制。" style={{ marginBottom: 16 }} />}
      </>}
      <Form.Item name="code" label="组织编码" normalize={normalizeCode} extra={!editing && CODE_HELP} rules={editing ? [] : codeRules('组织编码')}><Input disabled={Boolean(editing)} maxLength={32} placeholder="例如 DEPT_001" /></Form.Item>
      <Form.Item name="name" label="组织名称" rules={textRules('组织名称')}><Input maxLength={100} /></Form.Item>
      <Form.Item name="type" label="组织类型" rules={[{ required: true, message: '请选择合法的组织类型' }]}><Select disabled={Boolean(editing)} options={Object.entries(organizationTypeLabels)
        .filter(([value]) => editing ? value === editing.type : availableTypes.includes(value as Values['type']))
        .map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name="managerEmployeeId" label="部门负责人" extra="可按姓名或工号搜索在职员工，也可清空；设置负责人不会自动授予账号权限。">
        <Select allowClear showSearch filterOption={false} onSearch={setKeyword} loading={managerLoading} placeholder="请选择负责人"
          notFoundContent={managerLoading ? '正在加载' : '暂无匹配的在职员工，请输入姓名或工号搜索'}
          options={managerOptions.map(item => ({ value: item.id, label: item.name + '（' + item.employeeNo + '）' + (item.status === 'LEAVED' ? ' · 已离职' : ''), disabled: item.status === 'LEAVED' }))} />
      </Form.Item>
      <Form.Item name="sort" label="排序" extra="全体组织共用唯一序号，已占用号码不可选择；可输入数字搜索。" rules={[
        { required: true, message: '请选择排序号' },
        { validator: async (_, value) => { if (all.some(node => node.id !== editing?.id && node.sort === value)) throw new Error('排序号已被其他组织占用，请选择其他号码'); } },
      ]}><OrganizationSortSelect nodes={all} ownId={editing?.id} /></Form.Item>
    </Form>
  </Modal>;
}
