import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Statistic } from 'antd';
import { Link, useLocation } from 'react-router';
import Table from '@/components/ResizableTable';
import {
  inventoryApi,
  type InventoryDashboard,
  type InventoryQuery,
  type InventoryRow,
  type ItemKind,
} from '@/api/inventory';
import { useAuthStore } from '@/stores/authStore';
import { downloadBlob } from '@/api/approval-materials';
import { showRequestError } from '@/api/errors';

const titles: Record<string, string> = {
  items: '低值易耗品',
  'customized-records': '行政事务',
  'customized-statistics': '定制物品领用统计',
  'office-records': '办公用品领用明细',
  'office-statistics': '办公用品领用统计',
  inbound: '入库明细',
  outbound: '出库明细',
  stocktakes: '定期物品盘点记录',
  dashboard: '物品领用仪表盘',
};
const kindOptions = [
  { value: 'OFFICE', label: '办公用品' },
  { value: 'CUSTOMIZED', label: '定制物品' },
];
const quantityText = (value: unknown) =>
  value === null || value === undefined ? '—' : String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');

export default function InventoryAnalyticsPage() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[2] || 'dashboard';
  const isItems = section === 'items',
    isStats = section.endsWith('statistics'),
    isDashboard = section === 'dashboard',
    isStocktake = section === 'stocktakes';
  const fixedKind: ItemKind | undefined = section.startsWith('customized')
    ? 'CUSTOMIZED'
    : section.startsWith('office')
      ? 'OFFICE'
      : undefined;
  const has = useAuthStore((s) => s.hasPermission);
  const [rows, setRows] = useState<InventoryRow[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [dashboard, setDashboard] = useState<InventoryDashboard>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [filters, setFilters] = useState<InventoryQuery>({}),
    [draftFilters, setDraftFilters] = useState<InventoryQuery>({});
  const query: InventoryQuery = {
    ...filters,
    page,
    pageSize: 20,
    view: isItems
      ? 'items'
      : isStats
        ? 'statistics'
        : isStocktake
          ? 'stocktakes'
          : isDashboard
            ? 'dashboard'
            : 'movements',
    kind: fixedKind || filters.kind,
    action:
      section === 'inbound'
        ? 'INBOUND'
        : section === 'outbound' || section.endsWith('records')
          ? 'OUTBOUND'
          : undefined,
  };
  const queryKey = JSON.stringify(query);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const q = JSON.parse(queryKey) as InventoryQuery;
      if (q.view === 'dashboard') {
        const res = await inventoryApi.dashboard(q);
        if (current === generation.current) setDashboard(res.data);
      } else {
        const res = await inventoryApi.list(q);
        if (current === generation.current) {
          setRows(res.data.list);
          setTotal(res.data.total);
        }
      }
    } catch {
      if (current === generation.current) {
        setRows([]);
        setDashboard(undefined);
        setError('物品统计加载失败，请重试');
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [queryKey, setLoading, setError, setDashboard, setRows, setTotal]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      invalidate();
    };
  }, [load, invalidate]);

  const [busy, setBusy] = useState(false);
  const exportRows = async () => {
    setBusy(true);
    try {
      const res = await inventoryApi.export(query);
      downloadBlob(new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' }), res.data.fileName);
    } catch (e) {
      showRequestError(e, '导出失败');
    } finally {
      setBusy(false);
    }
  };
  const columns = [
    {
      title: '物品名称',
      dataIndex: 'itemName',
      width: 200,
      render: (name: string, row: InventoryRow) => <Link to={'/inventory/items/' + row.itemId}>{name}</Link>,
    },
    { title: '领用人', dataIndex: 'employeeName', width: 130 },
    { title: '领用组织', dataIndex: 'organizationPath', width: 300 },
    { title: '领用数量', dataIndex: 'quantity', width: 120, render: quantityText },
    { title: '单位', dataIndex: 'unit', width: 80 },
    { title: '领用笔数', dataIndex: 'count', width: 110 },
  ];
  return (
    <div>
      <h2>{titles[section] || '物品管理'}</h2>
      <p>实际领用与出库共用同一单据。库存调整需通过入库、领用或盘点登记，历史记录保留。</p>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          aria-label="物品查询"
          placeholder="物品名称、编码或领用人"
          value={draftFilters.keyword || ''}
          onChange={(e) => setDraftFilters({ ...draftFilters, keyword: e.target.value })}
          style={{ width: 240 }}
        />
        {!fixedKind && (
          <Select
            aria-label="物品类型筛选"
            placeholder="全部物品类型"
            allowClear
            value={draftFilters.kind}
            options={kindOptions}
            style={{ width: 160 }}
            onChange={(kind) => setDraftFilters({ ...draftFilters, kind })}
          />
        )}
        {!isItems && (
          <>
            <Input
              aria-label="开始日期"
              type="date"
              value={draftFilters.from || ''}
              onChange={(e) => setDraftFilters({ ...draftFilters, from: e.target.value })}
            />
            <Input
              aria-label="结束日期"
              type="date"
              value={draftFilters.to || ''}
              onChange={(e) => setDraftFilters({ ...draftFilters, to: e.target.value })}
            />
          </>
        )}
        {isStats && (
          <Select
            aria-label="统计维度"
            value={draftFilters.groupBy || 'item'}
            style={{ width: 150 }}
            options={[
              { value: 'item', label: '按物品统计' },
              { value: 'employee', label: '按领用人统计' },
              { value: 'organization', label: '按部门统计' },
            ]}
            onChange={(groupBy) => setDraftFilters({ ...draftFilters, groupBy })}
          />
        )}
        <Button
          type="primary"
          onClick={() => {
            setFilters(draftFilters);
            setPage(1);
          }}
        >
          查询
        </Button>
        <Button
          onClick={() => {
            setFilters({});
            setDraftFilters({});
            setPage(1);
          }}
        >
          重置
        </Button>
        <Button onClick={() => void load()}>刷新</Button>
        {!isDashboard && has('inventory.export') && (
          <Button loading={busy} onClick={() => void exportRows()}>
            导出当前筛选
          </Button>
        )}
      </Space>
      {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
      {isDashboard && (
        <>
          <Row gutter={16} style={{ marginBottom: 20 }}>
            {[
              ['物品种类', dashboard?.itemCount],
              ['低库存种类', dashboard?.lowStockCount],
              ['期间入库笔数', dashboard?.inboundCount],
              ['期间领用笔数', dashboard?.outboundCount],
            ].map(([label, value]) => (
              <Col key={String(label)} xs={12} md={6}>
                <Card>
                  <Statistic title={label} value={value ?? 0} />
                </Card>
              </Col>
            ))}
          </Row>
          <h3>领用物品（前 10 项，各自计量单位）</h3>
        </>
      )}
      <Table<InventoryRow>
        rowKey="id"
        columns={columns}
        dataSource={isDashboard ? dashboard?.top || [] : rows}
        loading={loading}
        locale={{ emptyText: '暂无物品记录' }}
        pagination={
          isDashboard
            ? false
            : { current: page, total, pageSize: 20, showSizeChanger: false, onChange: setPage }
        }
      />
    </div>
  );
}
