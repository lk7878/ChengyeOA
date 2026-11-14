import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Checkbox, Form, Input, Select, Spin } from 'antd';
import { get, post } from '@/features/workspaces/api';
import { showRequestError, requestErrorMessage } from '@/api/errors';
import type { SopTemplate, SopNode } from '@/features/sop/api';
type Context = {
  ref: { caseId: string | null; leadId: string | null; analysisEngagementId: string | null };
  source: { kind: string; title: string; route: string };
};
export default function SopStartPage() {
  const [params] = useSearchParams(),
    query = new URLSearchParams();
  for (const [param, field] of [
    ['case', 'caseId'],
    ['lead', 'leadId'],
    ['analysis', 'analysisEngagementId'],
    ['analysisContract', 'contractId'],
  ])
    if (params.get(param)) query.set(field, params.get(param)!);
  const sourceQuery = query.toString();
  return sourceQuery ? (
    <Starter key={sourceQuery} sourceQuery={sourceQuery} />
  ) : (
    <Alert type="warning" title="请从案件、线索或生效分析委托合同详情启动流程" />
  );
}
function Starter({ sourceQuery }: { sourceQuery: string }) {
  const navigate = useNavigate(),
    [templates, setTemplates] = useState<SopTemplate[]>(),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [context, setContext] = useState<Context>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [nodeState, setNodeState] = useState<{ versionId: string; nodes: SopNode[] }>(),
    [form] = Form.useForm(),
    key = useRef(crypto.randomUUID()),
    versionId = Form.useWatch('templateVersionId', form);
  const nodes = nodeState?.versionId === versionId ? (nodeState?.nodes ?? []) : [];
  useEffect(() => {
    let live = true;
    void get<Context>('/sop/source-context?' + sourceQuery)
      .then((result) => {
        if (live) {
          setContext(result);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(requestErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [sourceQuery]);
  useEffect(() => {
    let live = true;
    void get<{ list: SopTemplate[]; pagination: { total: number } }>(
      '/sop/templates?status=PUBLISHED&pageSize=50&page=' + page,
    )
      .then((result) => {
        if (live) {
          setTemplates(result.list.filter((t) => !!t.activeVersionId));
          setTotal(result.pagination.total);
        }
      })
      .catch((e) => {
        if (live) {
          setTemplates(undefined);
          setError(requestErrorMessage(e));
        }
      });
    return () => {
      live = false;
    };
  }, [page]);
  useEffect(() => {
    let live = true;
    if (versionId && context)
      void get<SopTemplate>('/sop/template-versions/' + versionId)
        .then((template) => {
          if (live) {
            const selected = template.versions.find((v) => v.id === versionId)?.content.nodes ?? [];
            setNodeState({ versionId, nodes: selected });
            setError('');
            form.setFieldValue(
              'nodeCodes',
              context.source.kind === 'CASE' ? selected.map((n) => n.code) : [],
            );
            key.current = crypto.randomUUID();
          }
        })
        .catch((e) => {
          if (live) setError(requestErrorMessage(e));
        });
    return () => {
      live = false;
    };
  }, [versionId, context, form]);
  async function save(values: { templateVersionId: string; batchKey: string; nodeCodes: string[] }) {
    if (!context) return;
    setBusy(true);
    try {
      const row = await post<{ id: string }>('/sop/instances', {
        ...values,
        ...context.ref,
        requestKey: key.current,
      });
      navigate('/sop/instances/' + row.id);
    } catch (e) {
      showRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="unified-area-page">
      <h1>启动SOP</h1>
      {context && <Link to={context.source.route}>返回{context.source.title}</Link>}
      {error && <Alert type="error" title={error} />} {!context && !error && <Spin />}
      {context && templates && (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ batchKey: 'PRIMARY' }}
          onFinish={(values) => void save(values)}
        >
          <Form.Item name="templateVersionId" label="已发布模板" rules={[{ required: true }]}>
            <Select
              options={templates.map((t) => ({
                value: t.activeVersionId,
                label: t.name + ' · ' + t.caseType,
              }))}
            />
          </Form.Item>
          <Button
            disabled={page <= 1}
            onClick={() => {
              form.setFieldValue('templateVersionId', undefined);
              setPage((p) => p - 1);
            }}
          >
            上一页模板
          </Button>{' '}
          <Button
            disabled={page * 50 >= total}
            onClick={() => {
              form.setFieldValue('templateVersionId', undefined);
              setPage((p) => p + 1);
            }}
          >
            下一页模板
          </Button>
          <Form.Item
            name="nodeCodes"
            label="本次执行节点"
            rules={[{ required: true, type: 'array', min: 1, message: '请选择本次适用节点' }]}
          >
            <Checkbox.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              options={nodes.map((n) => ({
                value: n.code,
                label: n.name + (n.dependsOn.length ? '（需包含依赖节点）' : ''),
              }))}
            />
          </Form.Item>
          <Form.Item name="batchKey" label="执行批次" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <p>
            选择当前阶段实际办理的节点，依赖节点必须一并选择。模板组织和团队需与来源一致；同一来源、版本、批次不会重复生成任务。
          </p>
          <Button type="primary" htmlType="submit" loading={busy} disabled={!nodes.length}>
            确认启动
          </Button>
        </Form>
      )}
    </section>
  );
}
