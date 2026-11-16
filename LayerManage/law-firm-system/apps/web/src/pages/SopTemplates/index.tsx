import Modal from '@/components/DraggableModal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag, message } from 'antd';
import Drawer from '@/components/DraggableDrawer';
import { Link, useSearchParams } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import {
  sopApi,
  newNode,
  type SopContent,
  type SopOptions,
  type SopTemplate,
  type SopVersion,
} from '@/features/sop/api';
import NodeEditor from '@/features/sop/NodeEditor';
import { governanceApi } from '@/features/admin-governance/api';
import { requestErrorMessage, showRequestError } from '@/api/errors';
const empty: SopOptions = { organizations: [], teams: [], roles: [], limit: 500 };
const labels = { DRAFT: '草稿', PUBLISHED: '已发布', DISABLED: '已停用' };
export default function SopTemplatesPage() {
  const [params, setParams] = useSearchParams(),
    targetVersion = params.get('templateVersion'),
    id = params.get('template') ?? targetVersion;
  const authorization = useAuthStore((s) => s.authorization),
    permissions = authorization?.permissions ?? [];
  const manage = permissions.includes('sop.template.manage'),
    publish =
      permissions.includes('sop.template.publish') && permissions.includes('governance.operation.create');
  const [rows, setRows] = useState<SopTemplate[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<SopTemplate>(),
    [selected, setSelected] = useState<string>();
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [options, setOptions] = useState<SopOptions>(empty),
    [presets, setPresets] = useState<{ code: string; name: string; content: SopContent }[]>([]);
  const [editor, setEditor] = useState<{
      kind: 'create' | 'edit';
      id?: string;
      version?: number;
      key: string;
    } | null>(null),
    [content, setContent] = useState<SopContent>({ schemaVersion: 1, nodes: [newNode(1)] }),
    [saving, setSaving] = useState(false),
    [form] = Form.useForm();
  const [action, setAction] = useState<{
      version: SopVersion;
      type: 'SOP_TEMPLATE_PUBLISH' | 'SOP_TEMPLATE_DISABLE';
      key: string;
    } | null>(null),
    [reason, setReason] = useState('');
  const alive = useRef(true),
    sequence = useRef(0),
    copyKey = useRef<{ source: string; key: string } | undefined>(undefined);
  const organizationId = Form.useWatch('organizationId', form);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const result = targetVersion
        ? await sopApi.forVersion(targetVersion)
        : id
          ? await sopApi.get(id)
          : await sopApi.list(page);
      if (!alive.current || seq !== sequence.current) return;
      if (id) setDetail(result.data as SopTemplate);
      else {
        const data = result.data as { list: SopTemplate[]; pagination: { total: number } };
        setRows(data.list);
        setTotal(data.pagination.total);
      }
      setError('');
    } catch (e) {
      if (alive.current && seq === sequence.current) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          setRows([]);
          setDetail(undefined);
          setEditor(null);
          setAction(null);
        }
        setError(requestErrorMessage(e));
      }
    } finally {
      if (alive.current && seq === sequence.current) setLoading(false);
    }
  }, [id, page, targetVersion]);
  useEffect(() => {
    alive.current = true;
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      alive.current = false;
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!manage) return;
    let live = true;
    void Promise.all([sopApi.options(), sopApi.presets()])
      .then(([o, p]) => {
        if (live) {
          setOptions(o.data);
          setPresets(p.data);
        }
      })
      .catch((e) => {
        if (live) setError(requestErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [manage]);
  const version = detail?.versions.find((v) => v.id === (selected ?? targetVersion)) ?? detail?.versions[0];
  const previous = detail?.versions.find((v) => version && v.number < version.number);
  const changes =
    version && previous
      ? [
          ...version.content.nodes
            .filter((n) => !previous.content.nodes.some((old) => old.code === n.code))
            .map((n) => '新增：' + n.name),
          ...previous.content.nodes
            .filter((n) => !version.content.nodes.some((next) => next.code === n.code))
            .map((n) => '移除：' + n.name),
          ...version.content.nodes
            .filter((n) => {
              const old = previous.content.nodes.find((v) => v.code === n.code);
              return old && JSON.stringify(old) !== JSON.stringify(n);
            })
            .map((n) => '配置调整：' + n.name),
          ...(JSON.stringify(version.content.nodes.map((n) => n.code)) !==
          JSON.stringify(previous.content.nodes.map((n) => n.code))
            ? ['节点排列已变化']
            : []),
        ]
      : [];
  async function save() {
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.kind === 'create') {
        const values = await form.validateFields();
        const result = await sopApi.create({ ...values, content, requestKey: editor.key });
        setParams({ template: result.data.id });
      } else await sopApi.update(editor.id!, editor.version!, content);
      setEditor(null);
      message.success('草稿已保存');
      await load();
    } catch (e) {
      showRequestError(e);
    } finally {
      setSaving(false);
    }
  }
  async function copy() {
    if (!detail || !version) return;
    setSaving(true);
    if (copyKey.current?.source !== version.id)
      copyKey.current = { source: version.id, key: crypto.randomUUID() };
    try {
      await sopApi.copy(detail.id, version.id, copyKey.current.key);
      copyKey.current = undefined;
      setSelected(undefined);
      await load();
      message.success('已复制为新草稿，请检查后申请发布');
    } catch (e) {
      showRequestError(e);
    } finally {
      setSaving(false);
    }
  }
  async function submit() {
    if (!action || !reason.trim()) return;
    setSaving(true);
    try {
      const input = {
        operationType: action.type,
        targetType: 'SOP_TEMPLATE_VERSION',
        targetId: action.version.id,
        expectedTargetVersion: action.version.version,
        payload: { contentHash: action.version.contentHash },
        reason: reason.trim(),
        idempotencyKey: action.key,
      };
      await governanceApi.create(input);
      setAction(null);
      await load();
      message.success('已提交治理审核');
    } catch (e) {
      showRequestError(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="unified-area-page">
      <Space wrap>
        <h1>SOP模板</h1>
        <Button onClick={() => void load()}>刷新模板</Button>
        {id && (
          <Button
            onClick={() => {
              setParams({});
              setDetail(undefined);
            }}
          >
            返回模板目录
          </Button>
        )}
        {manage && !id && (
          <Button
            type="primary"
            onClick={() => {
              form.resetFields();
              setContent(presets[0]?.content ?? { schemaVersion: 1, nodes: [newNode(1)] });
              setEditor({ kind: 'create', key: crypto.randomUUID() });
            }}
          >
            新建模板
          </Button>
        )}
      </Space>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void load()}>重试</Button>} />
      )}
      {!id ? (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 650 }}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          columns={[
            {
              title: '模板名称',
              dataIndex: 'name',
              render: (name: string, row: SopTemplate) => (
                <Button
                  type="link"
                  onClick={() => {
                    setSelected(undefined);
                    setParams({ template: row.id });
                  }}
                >
                  {name}
                </Button>
              ),
            },
            { title: '编码', dataIndex: 'code' },
            { title: '案件类型', dataIndex: 'caseType' },
            {
              title: '生效版本',
              render: (_, row: SopTemplate) =>
                row.activeVersionId
                  ? '第 ' + row.versions.find((v) => v.id === row.activeVersionId)?.number + ' 版'
                  : '尚未发布',
            },
          ]}
        />
      ) : (
        detail &&
        version && (
          <>
            <h2>{detail.name}</h2>
            <Space wrap>
              <Select
                aria-label="模板版本"
                value={version.id}
                onChange={setSelected}
                options={detail.versions.map((v) => ({
                  value: v.id,
                  label: `第 ${v.number} 版 · ${labels[v.status]}`,
                }))}
              />
              <Tag>{version.inReview ? '待治理审核' : labels[version.status]}</Tag>
              {manage && version.status === 'DRAFT' && !version.inReview && (
                <Button
                  onClick={() => {
                    setContent(structuredClone(version.content));
                    setEditor({
                      kind: 'edit',
                      id: version.id,
                      version: version.version,
                      key: crypto.randomUUID(),
                    });
                  }}
                >
                  编辑草稿
                </Button>
              )}
              {manage && (
                <Button loading={saving} onClick={() => void copy()}>
                  复制此版本为新草稿
                </Button>
              )}
              {publish && !version.inReview && version.status !== 'DISABLED' && (
                <Button
                  onClick={() => {
                    setReason('');
                    setAction({
                      version,
                      type: version.status === 'DRAFT' ? 'SOP_TEMPLATE_PUBLISH' : 'SOP_TEMPLATE_DISABLE',
                      key: crypto.randomUUID(),
                    });
                  }}
                >
                  {version.status === 'DRAFT' ? '申请发布' : '申请停用'}
                </Button>
              )}
              {version.governance && permissions.includes('governance.catalog.read') && (
                <Link to={'/security/admin-governance?operationId=' + version.governance.id}>
                  查看治理申请
                </Link>
              )}
            </Space>
            <p>已发布版本保持不变。历史版本回滚请复制为新草稿并重新审核发布。</p>
            {previous && (
              <details>
                <summary>与第 {previous.number} 版比较</summary>
                {changes.length ? (
                  <ul>
                    {changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  <p>节点内容一致</p>
                )}
              </details>
            )}
            <NodeEditor value={version.content} onChange={() => undefined} roles={options.roles} readOnly />
          </>
        )
      )}
      <Drawer
        title={editor?.kind === 'create' ? '新建SOP模板' : '编辑SOP草稿'}
        open={!!editor}
        onClose={() => !saving && setEditor(null)}
        size="large"
        extra={
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存草稿
          </Button>
        }
        destroyOnHidden
      >
        {editor?.kind === 'create' && (
          <Form form={form} layout="vertical">
            <Form.Item name="code" label="模板编码" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="organizationId" label="所属组织" rules={[{ required: true }]}>
              <Select
                options={options.organizations.map((o) => ({ value: o.id, label: o.name }))}
                onChange={() => form.setFieldValue('professionalTeamId', undefined)}
              />
            </Form.Item>
            <Form.Item name="professionalTeamId" label="专业团队" rules={[{ required: true }]}>
              <Select
                options={options.teams
                  .filter((t) => t.homeOrganizationId === organizationId)
                  .map((t) => ({ value: t.id, label: t.name }))}
              />
            </Form.Item>
            <Form.Item name="caseType" label="适用案件类型" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Select
              aria-label="预置节点模板"
              placeholder="选择预置节点"
              options={presets.map((p) => ({ value: p.code, label: p.name }))}
              onChange={(code) => setContent(structuredClone(presets.find((p) => p.code === code)!.content))}
            />
          </Form>
        )}
        <p>
          资料默认非强制，节点默认可并行。设置前置节点或必需材料后，须发布该版本才对新实例生效。候选最多显示500项。
        </p>
        <NodeEditor value={content} onChange={setContent} roles={options.roles} />
      </Drawer>
      <Modal
        okText="提交申请"
        cancelText="取消"
        title={action?.type === 'SOP_TEMPLATE_DISABLE' ? '申请停用模板' : '申请发布模板'}
        open={!!action}
        onCancel={() => !saving && setAction(null)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okButtonProps={{ disabled: reason.trim().length < 10 }}
      >
        <Input.TextArea
          aria-label="申请原因"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
        />
        <p>原因至少10个字符。审核过程在原治理中心完成，申请人不能审核自己的申请。</p>
      </Modal>
    </section>
  );
}
