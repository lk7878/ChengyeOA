import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Form, Input, Select, Spin } from 'antd';
import { get, post } from '@/features/workspaces/api';
import { showRequestError, requestErrorMessage } from '@/api/errors';
import type { SopTemplate } from '@/features/sop/api';
export default function SopStartPage() {
  const [params] = useSearchParams(),
    caseId = params.get('case');
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<SopTemplate[]>(),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [form] = Form.useForm();
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    let live = true;
    void get<{ list: SopTemplate[]; pagination: { total: number } }>(
      '/sop/templates?status=PUBLISHED&pageSize=50&page=' + page,
    )
      .then((result) => {
        if (live) {
          setTemplates(result.list.filter((t) => !!t.activeVersionId));
          setTotal(result.pagination.total);
          setError('');
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
  async function save(values: { templateVersionId: string; batchKey: string }) {
    setBusy(true);
    try {
      const row = await post<{ id: string }>('/sop/instances', {
        ...values,
        caseId,
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
      <h1>启动案件SOP</h1>
      {caseId ? (
        <Link to={'/cases/' + caseId}>返回原案件</Link>
      ) : (
        <Alert type="warning" title="请从案件详情启动流程" />
      )}
      {error && <Alert type="error" title={error} />} {!templates && !error && <Spin />}
      {caseId && templates && (
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
          <Form.Item name="batchKey" label="执行批次" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <p>
            模板组织、专业团队和案件类型必须与原案件吻合。重复同一批次不会重复生成任务；只有明确再次执行时才填写新批次。新任务未设置强制期限。
          </p>
          <Button type="primary" htmlType="submit" loading={busy}>
            确认启动
          </Button>
        </Form>
      )}
    </section>
  );
}
