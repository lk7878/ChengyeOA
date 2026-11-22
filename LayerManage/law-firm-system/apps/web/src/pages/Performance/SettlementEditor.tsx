import { useRef, useState } from 'react';
import { Alert, Button, Form, Input, Select, Space, Table, Tag } from 'antd';
import Modal from '@/components/DraggableModal';
import { get, post } from '@/features/workspaces/api';
import {
  applicablePolicy,
  amountInCents,
  displayCents,
  payError,
  payUrl,
  type PayView,
  type Settlement,
  type Source,
} from './case-pay-types';

type Props = { view: PayView; period: string; row?: Settlement; close: () => void; saved: () => void };
type SourceOption = Source | { id: string; caseNo: string; unavailableReason: string };

export function SettlementEditor({
  view,
  period,
  row,
  close,
  saved,
  refresh,
  openExisting,
}: Props & { refresh: () => void; openExisting: (period: string, caseNo: string) => void }) {
  const [team, setTeam] = useState<string | null>(row ? row.teamId : (view.leads[0] ?? null));
  const [allocatedCost, setAllocatedCost] = useState(row?.allocatedCost ?? '0');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const scope = team ?? 'personal:' + view.person?.id;
  const budget = view.costs.find((c) => c.scope === scope);
  const usedCost = view.rows
    .filter((r) => (team ? r.teamId === team : r.ownerEmployeeId === view.person?.id) && r.id !== row?.id)
    .reduce((sum, r) => sum + amountInCents(r.allocatedCost), 0n);
  const [source, setSource] = useState(row?.snapshot.source);
  const [options, setOptions] = useState<SourceOption[]>([]);
  const [query, setQuery] = useState('');
  const [basis, setBasis] = useState(row?.basisAmount ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(row?.snapshot.inputs ?? {});
  const nextLine = useRef(0);
  const [lines, setLines] = useState(
    (row?.lines ?? []).map((l) => ({
      key: l.employeeId,
      employeeId: l.employeeId,
      rate: l.rate,
      adjustment: l.adjustment,
      reason: l.reason,
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const p = applicablePolicy(view, team);
  const memberRule = (employeeId: string) => p?.memberRules?.find((rule) => rule.employeeId === employeeId);
  const inputFields = new Set([
    ...(p?.teamInputFields ?? []),
    ...lines.flatMap((line) => memberRule(line.employeeId)?.inputFields ?? []),
  ]);
  const stale = !!row && !!p && (row.snapshot.policyVersion !== p.version || row.policyId !== p.scopeId);
  const members = employeeOptions(view, team);
  function changeScope(id: string | null) {
    setTeam(id);
    setOptions([]);
    setSource(undefined);
    setLines([]);
    setInputs({});
    setQuery('');
    setBasis('');
    setError('');
    setMonthlyAmount('');
    setAllocatedCost('0');
  }
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
      okText={stale ? '按最新规则重算并保存' : '保存草稿'}
      okButtonProps={{ disabled: !p || !source || !!source.existing }}
      onOk={() =>
        run(async () => {
          await post(payUrl + '/save', {
            id: row?.id,
            version: row?.version,
            teamId: team,
            mode: team ? 'team' : 'personal',
            policyId: p?.scopeId,
            allocatedCost,
            caseId: source?.id,
            period,
            basisAmount: basis,
            policyVersion: p?.version,
            inputs,
            lines: lines.map(({employeeId, rate, adjustment, reason}) => ({employeeId, rate, adjustment, reason})),
          });
          saved();
        })
      }
    >
      {error && <Alert type="error" title={error} />}
      <Form layout="vertical">
        {stale && (
          <Alert
            type="info"
            title={'草稿使用规则 v' + row.snapshot.policyVersion + '，保存后按 v' + p.version + ' 重新计算。'}
          />
        )}
        <Space wrap>
          <Form.Item label="结算月份">{period}</Form.Item>
          <Form.Item label="办案方式">
            <Select
              value={team ? 'team' : 'personal'}
              disabled={!!row || busy}
              options={[
                { value: 'team', label: '团队办案', disabled: !view.leads.length },
                { value: 'personal', label: '个人办案' },
              ]}
              onChange={(v) => changeScope(v === 'team' ? view.leads[0] : null)}
            />
          </Form.Item>
          {team && (
            <Form.Item label="专业团队">
              <Select
                style={{ minWidth: 180 }}
                value={team}
                disabled={!!row || busy}
                options={view.teams
                  .filter((t) => view.leads.includes(t.id))
                  .map((t) => ({ value: t.id, label: t.name }))}
                onChange={changeScope}
              />
            </Form.Item>
          )}
        </Space>
        {!p && <Alert type="info" title="请先由超级管理员配置当前办案方式的结算规则和财务授权。" />}
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
                    const found = await get<SourceOption[]>(
                      payUrl +
                        '/sources?q=' +
                        encodeURIComponent(query) +
                        (team ? '&teamId=' + encodeURIComponent(team) : ''),
                    );
                    setOptions(found);
                    if (!found.length) setError('未找到符合当前办案方式、由本人主办或承办的可读案件');
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
              options={options.map((s) => ({
                value: s.id,
                disabled: 'unavailableReason' in s,
                label: s.caseNo + ' · ' + ('unavailableReason' in s ? s.unavailableReason : s.title + (s.existing ? '（已有结算）' : '')),
              }))}
              onChange={(id) => setSource(options.find((s): s is Source => s.id === id && !('unavailableReason' in s)))}
            />
          </Form.Item>
        )}
        {source?.existing && (
          <Alert
            type="info"
            title="该案件已有结算主单"
            action={
              source.existing.period && (
                <Button onClick={() => openExisting(source.existing!.period!, source.caseNo)}>
                  查看已有主单
                </Button>
              )
            }
          />
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
              {p.fields
                .filter((field) => inputFields.has(field))
                .map((f) => (
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
        {p && (
          <details>
            <summary>月度成本分摊</summary>
            <p>
              本月成本 {budget?.amount ?? '0'} 元，其他结算已分摊 {displayCents(usedCost)} 元。
            </p>
            <Space wrap>
              <Form.Item label="本月成本总额（元）">
                <Space.Compact>
                  <Input
                    value={monthlyAmount}
                    placeholder={budget?.amount ?? '0'}
                    onChange={(e) => setMonthlyAmount(e.target.value)}
                  />
                  <Button
                    disabled={busy || !monthlyAmount}
                    onClick={() =>
                      run(async () => {
                        await post(payUrl + '/cost', {
                          mode: team ? 'team' : 'personal',
                          teamId: team,
                          period,
                          amount: monthlyAmount,
                          version: budget?.version ?? 0,
                        });
                        setMonthlyAmount('');
                        refresh();
                      })
                    }
                  >
                    保存月度成本
                  </Button>
                </Space.Compact>
              </Form.Item>
              <Form.Item label="从本案扣除的成本（元）">
                <Input value={allocatedCost} onChange={(e) => setAllocatedCost(e.target.value)} />
              </Form.Item>
            </Space>
          </details>
        )}
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={lines}
          scroll={{ x: 650 }}
          columns={[
            {
              title: '分配成员',
              render: (_, l, i) => (
                <Select
                  aria-label="分配成员"
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 155 }}
                  value={l.employeeId || undefined}
                  options={members.filter(
                    (m) => !lines.some((other, n) => n !== i && other.employeeId === m.value),
                  )}
                  onChange={(v) => update(i, 'employeeId', v)}
                />
              ),
            },
            {
              title: '提成比例（%）',
              render: (_, l, i) => {
                const rule = memberRule(l.employeeId);
                return rule ? (
                  <span>{rule.rate}% · 个人规则</span>
                ) : (
                  <Input
                    aria-label="rate"
                    value={l.rate}
                    onChange={(e) => update(i, 'rate', e.target.value)}
                  />
                );
              },
            },
            ...(['adjustment', 'reason'] as const).map((k, i) => ({
              title: ['调整额（元）', '调整原因'][i],
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
          onClick={() => setLines([...lines, { key: 'new-' + ++nextLine.current, employeeId: '', rate: '0', adjustment: '0', reason: '' }])}
        >
          添加成员分配
        </Button>
      </Form>
    </Modal>
  );
}

function employeeOptions(view: PayView, team: string | null) {
  const people = team
    ? view.members.filter((m) => m.professionalTeamId === team).map((m) => m.employee)
    : view.directory;
  return people.map((p) => ({ value: p.id, label: p.name + ' · ' + p.employeeNo }));
}

export function SettlementPolicy({ view, close, saved }: Omit<Props, 'period' | 'row'>) {
  const [team, setTeam] = useState(view.teams[0]?.id);
  const [personal, setPersonal] = useState(!team);
  const [employeeId, setEmployeeId] = useState<string>();
  return (
    <Modal
      open
      width={600}
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      footer={null}
      title="案件结算规则与授权"
      onCancel={close}
    >
      <Form layout="vertical">
        <Form.Item label="办案方式">
          <Select
            value={personal ? 'personal' : 'team'}
            options={[
              { value: 'team', label: '团队办案' },
              { value: 'personal', label: '个人办案' },
            ]}
            onChange={(v) => setPersonal(v === 'personal')}
          />
        </Form.Item>
        {personal ? (
          <Form.Item label="规则适用人员">
            <Select
              showSearch
              optionFilterProp="label"
              value={employeeId ?? 'personal'}
              onChange={(v) => setEmployeeId(v === 'personal' ? undefined : v)}
              options={[{ value: 'personal', label: '个人办案默认规则' }, ...employeeOptions(view, null)]}
            />
          </Form.Item>
        ) : (
          <Form.Item label="专业团队">
            <Select
              value={team}
              onChange={setTeam}
              options={view.teams.map((t) => ({ label: t.name, value: t.id }))}
            />
          </Form.Item>
        )}
      </Form>
      {team || personal ? (
        <PolicyForm
          key={personal ? (employeeId ?? 'personal') : team}
          employeeId={personal ? employeeId : undefined}
          team={personal ? null : team}
          view={view}
          saved={saved}
        />
      ) : (
        <Alert type="info" title="请先在组织与人员中建立专业团队" />
      )}
    </Modal>
  );
}
function PolicyForm({
  view,
  team,
  employeeId,
  saved,
}: {
  view: PayView;
  team: string | null;
  employeeId?: string;
  saved: () => void;
}) {
  const p = view.policies.find(
      (p) => p.scopeId === (team ?? (employeeId ? 'personal:' + employeeId : 'personal')),
    ),
    accounts = view.accounts.map((u) => ({
      value: u.id,
      label: (u.employee?.name ?? u.username) + '（' + u.username + '）',
    }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Form
      layout="vertical"
      initialValues={{
        basis: p?.basis ?? 'received',
        formula: p?.formula ?? '基数',
        fields: p?.fields.join('，') ?? '',
        financeIds: p?.financeIds ?? [],
        directorId: p?.directorId,
        memberRules: p?.memberRules ?? [],
      }}
      onFinish={async (values) => {
        setBusy(true);
        setError('');
        try {
          await post(payUrl + '/policy', {
            ...values,
            teamId: team,
            mode: team ? 'team' : 'personal',
            employeeId,
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
      <fieldset>
        <legend>成员自定义绩效规则</legend>
        <p>可为指定成员设置案件提成，其余成员按结算明细填写的比例分配。</p>
        <Form.List name="memberRules">
          {(rules, { add, remove }) => (
            <>
              {rules.map(({ key, name }) => (
                <div key={key}>
                  <Form.Item
                    label="分配成员"
                    name={[name, 'employeeId']}
                    rules={[{ required: true, message: '请选择成员' }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder="按姓名或员工编号查找"
                      options={employeeOptions(view, team)}
                    />
                  </Form.Item>
                  <Form.Item
                    label="个人提成比例（%）"
                    name={[name, 'rate']}
                    rules={[{ required: true, message: '请输入提成比例' }]}
                  >
                    <Input inputMode="decimal" />
                  </Form.Item>
                  <Form.Item
                    label="个人案件提成公式"
                    name={[name, 'formula']}
                    rules={[{ required: true, message: '请输入公式' }]}
                    extra="可引用基数、可分配金额、个人提成比例和团队自定义数值字段。比例按百分数填写。"
                  >
                    <Input maxLength={250} />
                  </Form.Item>
                  <Button type="link" danger onClick={() => remove(name)}>
                    移除个人规则
                  </Button>
                </div>
              ))}
              <Button onClick={() => add({ rate: '0', formula: '可分配金额 * 个人提成比例 / 100' })}>
                添加成员规则
              </Button>
            </>
          )}
        </Form.List>
      </fieldset>
      <Form.Item name="financeIds" label="可汇总、确认和入薪的财务账号">
        <Select mode="multiple" showSearch optionFilterProp="label" options={accounts} />
      </Form.Item>
      <Form.Item name="directorId" label="工资审批主任" rules={[{ required: true }]}>
        <Select showSearch optionFilterProp="label" options={accounts} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>
        保存结算规则
      </Button>
    </Form>
  );
}
