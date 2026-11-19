import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Select, Space, Table, Tabs, Tag } from 'antd';
import { Link, useSearchParams } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import Modal from '@/components/DraggableModal';
import { get, post } from '@/features/workspaces/api';
import { payError, payUrl, statusName, type PayView, type Settlement } from './case-pay-types';
import { SettlementEditor, SettlementPolicy } from './SettlementEditor';

const month = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};
export default function CasePerformancePage() {
  const canReadCase = useAuthStore((s) => s.hasPermission('case.read'));
  const canReadContract = useAuthStore((s) => s.hasPermission('contract.read'));
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState(month),
    [revision, setRevision] = useState(0),
    [view, setView] = useState<PayView>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<Settlement | 'new'>(),
    [policy, setPolicy] = useState(false);
  const [action, setAction] = useState<{ row: Settlement; kind: string; title: string }>(),
    [batch, setBatch] = useState<string>(),
    [ids, setIds] = useState<string[]>([]),
    [importing, setImporting] = useState(false);
  const [team, setTeam] = useState<string>(),
    [q, setQ] = useState('');
  useEffect(() => {
    let active = true;
    get<PayView>(payUrl + '?period=' + period)
      .then((v) => {
        if (active) {
          setView(v);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setError(payError(e));
          setView(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [period, revision]);
  const tab = params.get('tab') ?? 'settlements';
  const refresh = () => {
    setRevision((n) => n + 1);
    setIds([]);
    setBatch(undefined);
  };
  const saved = () => {
    setEdit(undefined);
    setPolicy(false);
    setNotice('已保存');
    refresh();
  };
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice('操作完成');
      setAction(undefined);
      setImporting(false);
      refresh();
    } catch (e) {
      setError(payError(e));
    } finally {
      setBusy(false);
    }
  }
  const filtered = (view?.rows ?? []).filter(
    (r) =>
      (!team || r.teamId === team) &&
      [
        r.snapshot.source.caseNo,
        r.snapshot.source.title,
        r.snapshot.source.contractNo,
        ...r.lines.map((l) => l.name),
      ].some((s) => s.includes(q.trim())),
  );
  const teamName = (id: string) => view?.teams.find((t) => t.id === id)?.name ?? '历史团队';
  const sourceCell = (r: Settlement) => (
    <>
      <strong>{r.snapshot.source.title}</strong>
      <br />
      {canReadCase ? (
        <Link to={'/cases/' + encodeURIComponent(r.caseId)}>{r.snapshot.source.caseNo}</Link>
      ) : (
        r.snapshot.source.caseNo
      )}{' '}
      ·{' '}
      {canReadContract && r.snapshot.source.contractId ? (
        <Link to={'/contracts/' + encodeURIComponent(r.snapshot.source.contractId)}>
          {r.snapshot.source.contractNo}
        </Link>
      ) : (
        r.snapshot.source.contractNo || '未登记合同号'
      )}
    </>
  );
  const prompt = (row: Settlement, kind: string, title: string) => (
    <Button
      size="small"
      key={kind}
      onClick={() => {
        setError('');
        setAction({ row, kind, title });
      }}
    >
      {title}
    </Button>
  );
  const buttons = (row: Settlement) => {
    const linked = view?.batches.find((b) => b.id === row.payrollId);
    const editor = view?.editable.includes(row.teamId),
      finance = view?.finance.includes(row.teamId);
    return (
      <Space wrap>
        {editor && row.status === 'DRAFT' && (
          <>
            <Button size="small" onClick={() => setEdit(row)}>
              编辑
            </Button>
            {prompt(row, 'submit', '提交财务')}
            {prompt(row, 'delete', '删除草稿')}
          </>
        )}
        {editor && prompt(row, 'share', '共享设置')}
        {finance && row.status === 'SUBMITTED' && prompt(row, 'confirm', '确认金额')}
        {finance && ['SUBMITTED', 'CONFIRMED'].includes(row.status) && prompt(row, 'return', '退回修改')}
        {finance &&
          linked?.status === 'APPROVED' &&
          row.status === 'IN_PAYROLL' &&
          prompt(row, 'paid', '登记已发放')}
        {finance &&
          linked?.owner &&
          ['DRAFT', 'REJECTED', 'WITHDRAWN'].includes(linked.status) &&
          prompt(row, 'release', '撤销整批入薪')}
      </Space>
    );
  };
  const financeRows = filtered.filter(
    (r) => view?.finance.includes(r.teamId) && ['CONFIRMED', 'IN_PAYROLL', 'PAID'].includes(r.status),
  );
  const totals = new Map<
    string,
    { id: string; name: string; no: string; amount: bigint; cases: Settlement[] }
  >();
  for (const r of financeRows)
    for (const l of r.lines) {
      const item = totals.get(l.employeeId) ?? {
        id: l.employeeId,
        name: l.name,
        no: l.employeeNo,
        amount: 0n,
        cases: [],
      };
      const [whole, frac = ''] = String(l.amount).split('.');
      item.amount += BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
      item.cases.push(r);
      totals.set(l.employeeId, item);
    }
  return (
    <main className="unified-area-page">
      <div className="unified-area-heading">
        <h1>案件绩效</h1>
        <Space wrap>
          {view?.admin && <Button onClick={() => setPolicy(true)}>规则与授权</Button>}
          {!!view?.editable.length && (
            <Button type="primary" onClick={() => setEdit('new')}>
              新建结算
            </Button>
          )}
        </Space>
      </div>
      <Space wrap>
        <label>
          结算月份{' '}
          <Input
            type="month"
            value={period}
            onChange={(e) => {
              if (e.target.value) {
                setPeriod(e.target.value);
                setView(undefined);
                setIds([]);
                setBatch(undefined);
              }
            }}
          />
        </label>
        <Select
          aria-label="团队筛选"
          allowClear
          placeholder="全部可见团队"
          style={{ minWidth: 160 }}
          value={team}
          options={view?.teams.map((t) => ({ value: t.id, label: t.name }))}
          onChange={setTeam}
        />
        <Input
          allowClear
          aria-label="筛选案件或成员"
          placeholder="案件、合同编号或成员姓名"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button onClick={refresh}>刷新</Button>
      </Space>
      {error && <Alert type="error" title={error} showIcon />}
      {notice && <Alert type="success" title={notice} closable />}
      <Tabs
        activeKey={tab === 'finance' && !view?.finance.length ? 'settlements' : tab}
        onChange={(v) => setParams({ tab: v })}
        items={[
          {
            key: 'settlements',
            label: '案件结算',
            children: (
              <Table
                size="small"
                rowKey="id"
                dataSource={filtered}
                scroll={{ x: 800 }}
                locale={{ emptyText: <Empty description="本月暂无可见结算" /> }}
                expandable={{
                  expandedRowRender: (r) => (
                    <p>
                      承办律师 {r.snapshot.source.lawyer?.name ?? '待关联'} · 代理费{' '}
                      {r.snapshot.source.amount} 元 · 到款 {r.snapshot.source.received} 元 · 规则 v
                      {r.snapshot.policyVersion} · {r.snapshot.formula} ·{' '}
                      {Object.entries(r.snapshot.inputs)
                        .map(([k, v]) => k + ' ' + v)
                        .join('，')}{' '}
                      · {r.remark}
                    </p>
                  ),
                }}
                columns={[
                  { title: '案件 / 合同编号', render: (_, r) => sourceCell(r) },
                  { title: '团队', render: (_, r) => teamName(r.teamId) },
                  { title: '本期基数（元）', dataIndex: 'basisAmount' },
                  { title: '可分配（元）', dataIndex: 'pool' },
                  { title: '状态', render: (_, r) => <Tag>{statusName[r.status]}</Tag> },
                  { title: '操作', render: (_, r) => buttons(r) },
                ]}
              />
            ),
          },
          {
            key: 'lines',
            label: '成员分配明细',
            children: (
              <Table
                rowKey="id"
                size="small"
                scroll={{ x: 750 }}
                dataSource={filtered.flatMap((r) =>
                  r.lines.map((l) => ({ ...l, id: r.id + l.employeeId, row: r })),
                )}
                columns={[
                  { title: '成员', render: (_, l) => l.name + ' · ' + l.employeeNo },
                  { title: '案件', render: (_, l) => sourceCell(l.row) },
                  { title: '比例（%）', dataIndex: 'rate' },
                  { title: '调整额（元）', dataIndex: 'adjustment' },
                  { title: '调整原因', dataIndex: 'reason' },
                  { title: '分配金额（元）', dataIndex: 'amount' },
                  { title: '状态', render: (_, l) => statusName[l.row.status] },
                ]}
              />
            ),
          },
          ...(view?.finance.length
            ? [
                {
                  key: 'finance',
                  label: '财务月汇总',
                  children: (
                    <>
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={[...totals.values()]}
                        expandable={{
                          expandedRowRender: (t) =>
                            t.cases.map((r) => (
                              <div key={r.id}>
                                {r.snapshot.source.caseNo} · {teamName(r.teamId)} ·{' '}
                                {r.lines.find((l) => l.employeeId === t.id)?.amount} 元 ·{' '}
                                {statusName[r.status]}
                              </div>
                            )),
                        }}
                        columns={[
                          { title: '员工编号', dataIndex: 'no' },
                          { title: '姓名', dataIndex: 'name' },
                          { title: '案件数', render: (_, t) => t.cases.length },
                          {
                            title: '已确认绩效合计（元）',
                            render: (_, t) =>
                              String(t.amount / 100n) + '.' + String(t.amount % 100n).padStart(2, '0'),
                          },
                        ]}
                      />
                      <h3>入薪结算单</h3>
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={financeRows}
                        rowSelection={{
                          selectedRowKeys: ids,
                          onChange: (keys) => setIds(keys.map(String)),
                          getCheckboxProps: (r) => ({
                            disabled:
                              r.status !== 'CONFIRMED' &&
                              !['REJECTED', 'WITHDRAWN'].includes(
                                view.batches.find((b) => b.id === r.payrollId)?.status ?? '',
                              ),
                          }),
                        }}
                        columns={[
                          { title: '案件', render: (_, r) => sourceCell(r) },
                          { title: '金额（元）', dataIndex: 'pool' },
                          {
                            title: '工资批次',
                            render: (_, r) =>
                              view.batches.find((b) => b.id === r.payrollId)?.title ?? '待导入',
                          },
                          { title: '状态', render: (_, r) => statusName[r.status] },
                        ]}
                      />
                      <Space wrap>
                        <Link to="/payroll">工资表与审批</Link>
                        <Select
                          aria-label="工资草稿"
                          placeholder="选择本月工资草稿"
                          style={{ minWidth: 180 }}
                          value={batch}
                          options={view.drafts.map((d) => ({ value: d.id, label: d.title }))}
                          onChange={setBatch}
                        />
                        <Button disabled={!batch || !ids.length} onClick={() => setImporting(true)}>
                          导入所选结算单
                        </Button>
                      </Space>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {view && edit && (
        <SettlementEditor
          view={view}
          period={period}
          row={edit === 'new' ? undefined : edit}
          close={() => setEdit(undefined)}
          saved={saved}
        />
      )}
      {view && policy && <SettlementPolicy view={view} close={() => setPolicy(false)} saved={saved} />}
      {action && (
        <Modal
          open
          footer={null}
          title={action.title + ' · ' + action.row.snapshot.source.caseNo}
          onCancel={() => setAction(undefined)}
        >
          <Form
            layout="vertical"
            onFinish={(v) =>
              run(() =>
                action.kind === 'release'
                  ? post(payUrl + '/payroll/' + action.row.payrollId + '/release', {
                      version: view?.batches.find((b) => b.id === action.row.payrollId)?.version,
                    })
                  : post(payUrl + '/' + action.row.id + (action.kind === 'paid' ? '/paid' : '/action'), {
                      ...v,
                      expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : undefined,
                      action: action.kind === 'share' ? v.mode : action.kind,
                      version: action.row.version,
                    }),
              )
            }
            initialValues={{ mode: 'share' }}
          >
            {error && <Alert type="error" title={error} />}
            {action.kind === 'share' && (
              <>
                <Form.Item name="username" label="接收账号" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="mode" label="共享方式">
                  <Select
                    options={[
                      { value: 'share', label: '限时只读共享' },
                      { value: 'unshare', label: '撤销共享' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="expiresAt" label="共享截止时间">
                  <Input type="datetime-local" />
                </Form.Item>
              </>
            )}
            {action.kind === 'return' && (
              <Form.Item label="退回原因" name="reason" rules={[{ required: true }]}>
                <Input.TextArea />
              </Form.Item>
            )}
            {action.kind === 'release' && (
              <p>
                本次将撤销该工资批次的整笔导入，并恢复全部关联结算单的待入薪状态。尚未提交的工资草稿将恢复至导入前的版本。
              </p>
            )}
            {action.kind === 'paid' && <p>请核对实际发放凭证后登记。系统将检查此工资批次的主任审批记录。</p>}
            {action.kind === 'submit' && <p>确认将本期结算和成员分配提交给本团队获授权的财务人员？</p>}
            {action.kind === 'delete' && <p>确认删除此草稿和对应分配明细？</p>}
            <Button loading={busy} type="primary" htmlType="submit">
              确认
            </Button>
          </Form>
        </Modal>
      )}
      {importing && (
        <Modal
          open
          title="导入工资草稿"
          okText="确认导入"
          confirmLoading={busy}
          onCancel={() => setImporting(false)}
          onOk={() =>
            run(() =>
              post(payUrl + '/payroll/' + batch, {
                version: view?.drafts.find((d) => d.id === batch)?.version,
                ids,
              }),
            )
          }
        >
          {error && <Alert type="error" title={error} />}已选 {ids.length}{' '}
          张结算单。将按“员工编号”填写“案件绩效”列。请先完成工资草稿的其他编辑，导入后该版本将用于审批。
        </Modal>
      )}
    </main>
  );
}
