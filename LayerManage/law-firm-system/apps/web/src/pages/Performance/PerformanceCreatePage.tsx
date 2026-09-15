import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Select, message } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { performanceApi, masterDataApi } from '@/api/organization';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import FinanceChoicePicker, { type ChoiceLoader } from '@/pages/finance/FinanceChoicePicker';

export default function PerformanceCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const has = useAuthStore((s) => s.hasPermission);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback<ChoiceLoader>(async (page, keyword) => {
    const result = (await masterDataApi.employees.list({ page, pageSize: 20, keyword: keyword || undefined }))
      .data;
    return {
      total: result.pagination.total,
      list: result.list
        .filter((e) => e.status !== 'LEAVED')
        .map((e) => ({ id: e.id, label: e.name + ' / ' + e.employeeNo })),
    };
  }, []);
  const back = '/performances' + (params.size ? '?' + params.toString() : '');
  return (
    <div className="unified-area-page">
      <Link to={back}>返回绩效工作表</Link>
      <h1>登记绩效</h1>
      {error && <Alert type="error" title={error} />}
      {!has('performance.create') || !has('employee.read') ? (
        <Alert type="warning" title="登记绩效需要绩效创建与员工读取权限。" />
      ) : (
        <Card style={{ maxWidth: 760 }}>
          <Form
            layout="vertical"
            initialValues={{ type: 'MONTHLY', period: new Date().toISOString().slice(0, 7) }}
            onFinish={async (values) => {
              if (busy) return;
              const data = { ...values, period: values.period.trim() };
              const body = JSON.stringify(data);
              if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
              setBusy(true);
              try {
                const result = await performanceApi.create({ ...data, idempotencyKey: attempt.current!.key });
                if (alive.current) {
                  message.success('绩效已登记');
                  navigate('/performances/' + result.data.id + (params.size ? '?' + params.toString() : ''));
                }
              } catch (e) {
                if (alive.current) setError(requestErrorMessage(e));
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            <Form.Item
              label="被考核人"
              name="employeeId"
              rules={[{ required: true, message: '请选择被考核人' }]}
            >
              <FinanceChoicePicker label="被考核人" load={load} />
            </Form.Item>
            <Form.Item
              label="考核周期"
              name="period"
              rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: '请填写 YYYY-MM' }]}
            >
              <Input placeholder="YYYY-MM" />
            </Form.Item>
            <Form.Item label="考核类型" name="type" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'MONTHLY', label: '月度' },
                  { value: 'QUARTERLY', label: '季度' },
                  { value: 'YEARLY', label: '年度' },
                ]}
              />
            </Form.Item>
            <Form.Item label="绩效分数" name="score">
              <InputNumber stringMode precision={2} min="0" />
            </Form.Item>
            <Form.Item label="奖金" name="bonus">
              <InputNumber stringMode precision={2} min="0" />
            </Form.Item>
            <Form.Item label="备注" name="remark">
              <Input.TextArea maxLength={500} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              保存绩效
            </Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
