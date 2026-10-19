import { formatMoney } from '@/utils/business-format';
import { useEffect, useState } from 'react';
import { Alert, Button, Select, Space, Table } from 'antd';
import { Link } from 'react-router';
import { negotiationApi, type NegotiationStatus, type NegotiationView } from '@/api/negotiation';
import { errorMessage } from '@/features/workspaces/api';
import { NEGOTIATION_STATUS_META } from '../contracts/meta';

/** Formal records remain discoverable even before a workspace table is connected. */
export default function NegotiationList() {
  const [rows, setRows] = useState<NegotiationView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<NegotiationStatus>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void negotiationApi
      .list({ page, pageSize: 20, status })
      .then(({ data }) => {
        if (active) {
          setRows(data.list);
          setTotal(data.total);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setRows([]);
          setTotal(0);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, status, revision]);
  return (
    <section aria-label="谈案记录">
      <h2>谈案记录</h2>
      <p>
        这里展示您有权查看的正式谈案，包含谈案中、已签约和未签约记录。完结会更新原记录；普通多维表格需通过“连接业务数据”展示这些记录。
      </p>
      <Space>
        <Select
          aria-label="谈案状态"
          style={{ width: 160 }}
          value={status}
          allowClear
          placeholder="全部状态"
          options={Object.entries(NEGOTIATION_STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.text,
          }))}
          onChange={(value) => {
            setLoading(true);
            setPage(1);
            setStatus(value);
          }}
        />
        <Button
          onClick={() => {
            setLoading(true);
            setRevision((n) => n + 1);
          }}
        >
          刷新谈案记录
        </Button>
      </Space>
      {error && <Alert type="error" title={error} />}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 650 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: (value) => {
            setLoading(true);
            setPage(value);
          },
        }}
        columns={[
          { title: '谈案编号', dataIndex: 'negotiationNo' },
          {
            title: '状态',
            dataIndex: 'status',
            render: (value: NegotiationStatus) => NEGOTIATION_STATUS_META[value].text,
          },
          { title: '报价金额（元）', dataIndex: 'quotedAmount', render: formatMoney },
          { title: '未签原因', dataIndex: 'unsignedReason', render: (value) => value || '—' },
          { title: '操作', render: (_, row) => <Link to={'/negotiations/' + row.id}>详情与办理</Link> },
        ]}
      />
    </section>
  );
}
