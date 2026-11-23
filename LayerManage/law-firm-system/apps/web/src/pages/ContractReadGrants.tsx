import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Popconfirm, Result, Select, Space, Spin, Table, message } from 'antd';
import { contractApi } from '@/api/contract';
import request from '@/api/request';
import { authorizationAdminApi, authorizationErrorMessage } from '@/features/authorization/admin-api';
import { useAuthStore } from '@/stores/authStore';
import type { ApiResponse } from '@/types';

type Choice = { value: string; label: string; inactive?: boolean };
type Grant = { createdAt: string; contract: { id: string; contractNo: string; title: string; deletedAt: string | null } };
const grantPath = (id: string) => '/v1/authorization/users/' + encodeURIComponent(id) + '/contract-read-grants';

async function searchPeople(keyword: string): Promise<Choice[]> {
  const page = await authorizationAdminApi.users.list({ keyword, pageSize: 50 });
  return page.list.map(user => ({
    value: user.id, label: user.employee ? user.employee.name + '（' + user.username + '）' : user.username,
    inactive: user.status !== 'ENABLED',
  }));
}

async function searchContracts(keyword: string): Promise<Choice[]> {
  const { data } = await contractApi.list({ keyword, pageSize: 50 });
  return data.list.map(contract => ({ value: contract.id, label: contract.contractNo + ' · ' + contract.title }));
}

function SearchSelect({ label, search, value, onChange, disabled }: {
  label: string; search: (query: string) => Promise<Choice[]>; value?: Choice;
  onChange: (choice?: Choice) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const found = await search(query.trim());
        if (current) setOptions(found);
      } catch (cause) {
        if (current) setError(authorizationErrorMessage(cause));
      } finally {
        if (current) setLoading(false);
      }
    }, 180);
    return () => { current = false; clearTimeout(timer); };
  }, [query, search]);
  return <Select aria-label={label} placeholder={label} style={{ width: 'min(390px, 100%)' }}
    allowClear labelInValue value={value} options={options} disabled={disabled} loading={loading}
    showSearch={{ filterOption: false, onSearch: text => {
      if (text !== query) { setQuery(text); setOptions([]); setError(''); setLoading(true); }
    } }}
    onChange={choice => onChange(choice ? options.find(item => item.value === choice.value) : undefined)}
    notFoundContent={loading ? '查询中…' : error || '没有匹配结果'} />;
}

function PersonGrants({ person, self }: { person: Choice; self: boolean }) {
  const [grants, setGrants] = useState<Grant[]>();
  const [contract, selectContract] = useState<Choice>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const path = grantPath(person.value);
  const reload = () => { setGrants(undefined); setError(''); setRevision(n => n + 1); };
  useEffect(() => {
    let current = true;
    request.get<ApiResponse<Grant[]>>(path).then(result => {
      if (current) setGrants(result.data);
    }).catch(cause => { if (current) setError(authorizationErrorMessage(cause)); });
    return () => { current = false; };
  }, [path, revision]);

  async function change(id: string, action: 'grant' | 'revoke') {
    setBusy(true);
    setError('');
    try {
      const url = path + '/' + encodeURIComponent(id);
      if (action === 'grant') {
        await request.put(url);
        selectContract(undefined);
      } else {
        await request.delete(url);
      }
      message.success(action === 'grant' ? '已授予合同只读权限' : '已撤销单份合同授权');
      reload();
    } catch (cause) { setError(authorizationErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  const alreadyGranted = contract && grants?.some(row => row.contract.id === contract.value);
  return <section>
    <h2>{person.label}的单份合同授权</h2>
    <p>此处列出直接授予该账号的合同读取权。撤销单份授权后，角色或团队授予的权限仍然适用。</p>
    {self ? <p>当前账号 · 不可自改授权</p> : person.inactive ? <p>该账号已停用，可撤销已有授权。</p> :
      <Space wrap>
        <SearchSelect label="搜索合同编号或名称" search={searchContracts} value={contract} onChange={selectContract} disabled={busy}/>
        <Popconfirm title={'为' + person.label + '授予只读权限？'} description={contract?.label}
          okText="确认授予" cancelText="取消" onConfirm={() => contract && change(contract.value, 'grant')}>
          <Button type="primary" disabled={!contract || !grants || busy || alreadyGranted}>{alreadyGranted ? '已授权' : '授予只读权限'}</Button>
        </Popconfirm>
      </Space>}
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={reload}>重新加载</Button>} />}
    {grants ? <Table style={{ marginTop: 16 }} dataSource={grants} rowKey={item => item.contract.id}
      locale={{ emptyText: <Empty description="该账号暂无单份合同授权" /> }} pagination={{ pageSize: 10, hideOnSinglePage: true }}
      columns={[
        { title: '合同编号', render: (_, row) => row.contract.contractNo },
        { title: '合同名称', render: (_, row) => row.contract.title + (row.contract.deletedAt ? '（已归档）' : '') },
        { title: '授权时间', render: (_, row) => new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }) },
        { title: '操作', render: (_, row) => <Popconfirm title={'撤销' + person.label + '的合同只读授权？'}
          description={row.contract.contractNo + ' · ' + row.contract.title} okText="确认撤销" cancelText="取消"
          onConfirm={() => change(row.contract.id, 'revoke')}>
          <Button danger disabled={self || busy}>撤销</Button>
        </Popconfirm> },
      ]}/> : !error && <Spin />}
  </section>;
}

export default function ContractReadGrantsPage() {
  const auth = useAuthStore(state => state.authorization);
  const [person, selectPerson] = useState<Choice>();
  if (!auth?.isSystemSuperAdmin) return <Result status="403" title="仅超级管理员可管理单份合同授权" />;
  return <main className="unified-area-page">
    <h1>单份合同只读授权</h1>
    <SearchSelect label="按账号或姓名搜索人员" search={searchPeople} value={person} onChange={selectPerson}/>
    {person && <PersonGrants key={person.value} person={person} self={person.value === auth.userId}/>}
  </main>;
}
