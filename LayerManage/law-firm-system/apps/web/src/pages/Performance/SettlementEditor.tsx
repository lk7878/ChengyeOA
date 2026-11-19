import { useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag } from 'antd';
import Modal from '@/components/DraggableModal';
import { get, post } from '@/features/workspaces/api';
import { payError, payUrl, type PayView, type Settlement, type Source } from './case-pay-types';

type Props = { view: PayView; period: string; row?: Settlement; close: () => void; saved: () => void };
export function SettlementEditor({ view, period, row, close, saved }: Props) {
  const [team, setTeam] = useState(row?.teamId ?? view.editable[0]);
  const [source, setSource] = useState(row?.snapshot.source);
  const [options, setOptions] = useState<Source[]>([]);
  const [query, setQuery] = useState('');
  const [basis, setBasis] = useState(row?.basisAmount ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(row?.snapshot.inputs ?? {});
  const [lines, setLines] = useState(
    (row?.lines ?? []).map((l) => ({
      employeeId: l.employeeId,
      rate: l.rate,
      adjustment: l.adjustment,
      reason: l.reason,
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const p = view.policies.find((p) => p.teamId === team);
  const members = view.members
    .filter((m) => m.professionalTeamId === team)
    .map((m) => ({ value: m.employee.id, label: m.employee.name + ' · ' + m.employee.employeeNo }));
  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(payError(e));
    } finally {
      setBusy(false);
    }
  }
  const update = (i: number, key: keyof (typeof lines)[number], value: string) =>
    setLines(lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)));
  return (
    <Modal
      open
      width={840}
      title={row ? '编辑案件结算' : '新建案件结算'}
      onCancel={close}
      confirmLoading={busy}
      okText="保存草稿"
      okButtonProps={{ disabled: !p || !source }}
      onOk={() =>
        run(async () => {
          await post(payUrl + '/save', {
            id: row?.id,
            version: row?.version,
            teamId: team,
            caseId: source?.id,
            period,
            basisAmount: basis,
            policyVersion: p?.version,
            inputs,
            lines,
          });
          saved();
        })
      }
    >
      {error && <Alert type="error" title={error} />}
      <Form layout="vertical">
        <Space wrap>
          <Form.Item label="结算月份">{period}</Form.Item>
          <Form.Item label="专业团队">
            <Select
              style={{ minWidth: 180 }}
              value={team}
              disabled={!!row}
              options={view.teams
                .filter((t) => view.editable.includes(t.id))
                .map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => {
                setTeam(v);
                setLines([]);
                setInputs({});
              }}
            />
          </Form.Item>
        </Space>
        {!p && <Alert type="info" title="请先由超级管理员配置此团队的结算规则和财务授权。" />}
        {!row && (
          <Form.Item label="查找关联案件">
            <Space.Compact block>
              <Input
                placeholder="案件编号、名称或合同编号"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                loading={busy}
                onClick={() =>
                  run(async () => {
                    const found = await get<Source[]>(payUrl + '/sources?q=' + encodeURIComponent(query));
                    setOptions(found);
                    if (!found.length) setError('未找到可访问的案件');
                  })
                }
              >
                查找
              </Button>
            </Space.Compact>
            <Select
              style={{ width: '100%' }}
              placeholder="选择案件"
              value={source?.id}
              options={options.map((s) => ({ value: s.id, label: s.caseNo + ' · ' + s.title }))}
              onChange={(id) => setSource(options.find((s) => s.id === id))}
            />
          </Form.Item>
        )}
        {source && (
          <p>
            {source.title} · 合同 {source.contractNo || '待登记'} · 承办律师 {source.lawyer?.name || '待关联'}{' '}
            · 代理费 {source.amount} 元 · 到款 {source.received} 元
          </p>
        )}
        {p && (
          <>
            <p>
              <Tag>规则 v{p.version}</Tag>可分配金额 = {p.formula}
            </p>
            <Space wrap>
              <Form.Item label={'本期基数（元，按' + (p.basis === 'received' ? '到款' : '代理费') + '）'}>
                <Input value={basis} onChange={(e) => setBasis(e.target.value)} />
              </Form.Item>
              {p.fields.map((f) => (
                <Form.Item label={f} key={f}>
                  <Input
                    value={inputs[f] ?? ''}
                    onChange={(e) => setInputs({ ...inputs, [f]: e.target.value })}
                  />
                </Form.Item>
              ))}
            </Space>
          </>
        )}
        <Table
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={false}
          dataSource={lines}
          scroll={{ x: 650 }}
          columns={[
            {
              title: '团队成员',
              render: (_, l, i) => (
                <Select
                  aria-label="团队成员"
                  style={{ minWidth: 155 }}
                  value={l.employeeId || undefined}
                  options={members}
                  onChange={(v) => update(i, 'employeeId', v)}
                />
              ),
            },
            ...(['rate', 'adjustment', 'reason'] as const).map((k, i) => ({
              title: ['比例（%）', '调整额（元）', '调整原因'][i],
              render: (_: unknown, l: (typeof lines)[number], n: number) => (
                <Input value={l[k]} aria-label={k} onChange={(e) => update(n, k, e.target.value)} />
              ),
            })),
            {
              title: '操作',
              render: (_, __, i) => (
                <Button type="link" danger onClick={() => setLines(lines.filter((_, n) => i !== n))}>
                  移除
                </Button>
              ),
            },
          ]}
        />
        <Button
          onClick={() => setLines([...lines, { employeeId: '', rate: '0', adjustment: '0', reason: '' }])}
        >
          添加成员分配
        </Button>
      </Form>
    </Modal>
  );
}

export function SettlementPolicy({ view, close, saved }: Omit<Props, 'period' | 'row'>) {
  const [team, setTeam] = useState(view.teams[0]?.id);
  return (
    <Modal open footer={null} title="团队结算规则与授权" onCancel={close}>
      <Form layout="vertical">
        <Form.Item label="专业团队">
          <Select
            value={team}
            onChange={setTeam}
            options={view.teams.map((t) => ({ label: t.name, value: t.id }))}
          />
        </Form.Item>
      </Form>
      {team ? (
        <PolicyForm key={team} team={team} view={view} saved={saved} />
      ) : (
        <Alert type="info" title="请先在组织与人员中建立专业团队" />
      )}
    </Modal>
  );
}
function PolicyForm({ view, team, saved }: { view: PayView; team: string; saved: () => void }) {
  const p = view.policies.find((p) => p.teamId === team),
    accounts = view.accounts.map((u) => ({
      value: u.id,
      label: (u.employee?.name ?? u.username) + '（' + u.username + '）',
    }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Form
      key={team}
      layout="vertical"
      initialValues={{
        basis: p?.basis ?? 'received',
        formula: p?.formula ?? '基数',
        fields: p?.fields.join('，') ?? '',
        financeIds: p?.financeIds ?? [],
        directorId: p?.directorId,
      }}
      onFinish={async (values) => {
        setBusy(true);
        setError('');
        try {
          await post(payUrl + '/policy', {
            ...values,
            teamId: team,
            version: p?.version ?? 0,
            fields: (values.fields ?? '')
              .split(/[，,]/)
              .map((s: string) => s.trim())
              .filter(Boolean),
          });
          saved();
        } catch (e) {
          setError(payError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert type="error" title={error} />}
      <Form.Item name="basis" label="结算基数来源">
        <Select
          options={[
            { value: 'received', label: '到款金额' },
            { value: 'amount', label: '合同或案件代理费总额' },
          ]}
        />
      </Form.Item>
      <Form.Item name="fields" label="自定义数值字段（逗号分隔）">
        <Input placeholder="成本，提成比例" />
      </Form.Item>
      <Form.Item
        name="formula"
        label="可分配金额公式"
        extra="支持字段名、基数、括号和 + − × ÷（输入 + - * /）。"
      >
        <Input placeholder="(基数 - 成本) * 提成比例 / 100" />
      </Form.Item>
      <Form.Item name="financeIds" label="可汇总、确认和入薪的财务账号">
        <Select mode="multiple" showSearch optionFilterProp="label" options={accounts} />
      </Form.Item>
      <Form.Item name="directorId" label="工资审批主任" rules={[{ required: true }]}>
        <Select showSearch optionFilterProp="label" options={accounts} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>
        保存团队规则
      </Button>
    </Form>
  );
}
