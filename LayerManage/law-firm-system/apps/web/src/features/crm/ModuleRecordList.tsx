import { useMenuLabels } from '@/features/navigation/menu-labels';
import { formatMoney, formatBusinessDate, refundStatusLabels } from '@/utils/business-format';
import { useEffect, useState } from 'react';
import { Alert, Button, Input, Space, Table } from 'antd';
import Modal from '@/components/DraggableModal';
import { Link, useSearchParams } from 'react-router';
import request from '@/api/request';
import type { ApiResponse } from '@/types';
import { errorMessage } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';
import { businessSources, type BusinessSource } from './business-sources';
import { moduleRecords, recordCell } from './module-records';
import { financeContextParams, financialSources } from '@/pages/finance/context';

type Row = { id: string; version?: number; leadId?: string } & Record<string, unknown>;
type Page = { list: Row[]; total?: number; pagination?: { total: number } };
export default function ModuleRecordList({ source }: { source: Exclude<BusinessSource, 'NEGOTIATIONS'> }) {
  const definition = moduleRecords[source];
  const [params] = useSearchParams();
  const context = financialSources.includes(source) ? financeContextParams(params) : {};
  const contextKey = JSON.stringify(context);
  const queryContext =
    source === 'COSTS'
      ? context.case
        ? { caseId: context.case }
        : {}
      : context.contract
        ? { contractId: context.contract }
        : {};
  const queryContextKey = JSON.stringify(queryContext);
  const has = useAuthStore((state) => state.hasPermission);
  const [result, setResult] = useState<Page>({ list: [], total: 0 });
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [removing, setRemoving] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useEffect(() => {
    let active = true;
    void request
      .get<ApiResponse<Page>>(definition.endpoint, {
        params: {
          page,
          pageSize: 20,
          ...definition.params,
          ...JSON.parse(queryContextKey),
          ...(definition.keyword && keyword ? { [definition.keyword]: keyword } : {}),
        },
      })
      .then(({ data }) => {
        if (active) {
          setResult(data);
          setError('');
        }
      })
      .catch((reason) => {
        if (active) {
          setResult({ list: [], total: 0 });
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [definition, page, keyword, revision, queryContextKey]);
  const refresh = () => {
    setLoading(true);
    setRevision((n) => n + 1);
  };
  const { sourceLabel } = useMenuLabels();
  const title = sourceLabel(source);
  const href = (row: Row) => {
    const path = source === 'FOLLOWS' ? '/leads/' + row.leadId : businessSources[source].path + '/' + row.id;
    return path + (contextKey !== '{}' ? '?' + new URLSearchParams(context) : '');
  };
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <p>
        已保存的业务记录直接显示在这里，按角色权限和数据范围展示。打开“详情与办理”可进行获准的修改、删除或状态操作。
      </p>
      <Space wrap>
        {definition.keyword && (
          <Input.Search
            aria-label="搜索业务记录"
            placeholder="搜索编号或名称"
            allowClear
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
              refresh();
            }}
          />
        )}
        <Button onClick={refresh}>刷新记录</Button>
      </Space>
      {error && <Alert type="error" showIcon title={error} />}
      {success && <Alert type="success" showIcon title={success} />}
      <Table<Row>
        rowKey="id"
        dataSource={result.list}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize: 20,
          showSizeChanger: false,
          total: result.total ?? result.pagination?.total ?? 0,
          onChange: (value) => {
            setLoading(true);
            setPage(value);
          },
        }}
        columns={[
          ...definition.columns.map(([dataIndex, title]) => ({ dataIndex, title: ['amount', 'fee', 'quotedAmount'].includes(dataIndex) && !title.includes('元') ? title + '（元）' : title,
            render: (value: unknown) => ['amount', 'fee', 'quotedAmount'].includes(dataIndex) ? formatMoney(value) : source === 'REFUNDS' && dataIndex === 'status' ? refundStatusLabels[String(value)] || recordCell(value) : recordCell(value) })),
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (value: unknown) =>
              formatBusinessDate(value),
          },
          {
            title: '操作',
            key: 'actions',
            render: (_, row) => (
              <Space>
                <Link to={href(row)}>{definition.edit && has(definition.edit) ? '详情与办理' : '详情'}</Link>
                {definition.remove && has(definition.remove) && (
                  <Button
                    type="link"
                    danger
                    onClick={() => {
                      setRemoving(row);
                      setDeleteError('');
                    }}
                  >
                    删除
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="删除业务记录"
        open={!!removing}
        confirmLoading={busy}
        okText="确认删除"
        okButtonProps={{ danger: true }}
        onCancel={() => {
          if (!busy) setRemoving(undefined);
        }}
        onOk={async () => {
          if (!removing || !definition.remove || !has(definition.remove)) return;
          setBusy(true);
          setDeleteError('');
          try {
            await request.delete(definition.endpoint + '/' + removing.id, {
              data: source === 'COSTS' ? undefined : { version: removing.version },
            });
            setRemoving(undefined);
            setSuccess('记录已删除');
            setPage(1);
            refresh();
          } catch (reason) {
            setDeleteError(errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          确认删除“
          {recordCell(
            removing?.name ?? removing?.title ?? removing?.customerNo ?? removing?.caseNo ?? removing?.id,
          )}
          ”？系统将检查关联业务、记录状态和删除权限。
        </p>
        {deleteError && <Alert type="error" title={deleteError} />}
      </Modal>
    </section>
  );
}
