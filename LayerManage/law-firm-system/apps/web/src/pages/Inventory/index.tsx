import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Tag, message } from 'antd';
import { useLocation } from 'react-router';
import dayjs from 'dayjs';
import Table from '@/components/ResizableTable';
import { inventoryApi, type InventoryDashboard, type InventoryItem, type InventoryQuery, type InventoryRecipient, type InventoryRow, type ItemKind } from '@/api/inventory';
import { useAuthStore } from '@/stores/authStore';
import { downloadBlob } from '@/api/approval-materials';
import { showRequestError } from '@/api/errors';

const titles: Record<string, string> = { items: '物品档案与库存', 'customized-records': '定制物品领用登记', 'customized-statistics': '定制物品领用统计', 'office-records': '办公用品领用明细', 'office-statistics': '办公用品领用统计', inbound: '入库明细', outbound: '出库明细', stocktakes: '定期物品盘点记录', dashboard: '物品领用仪表盘' };
const kindOptions = [{ value: 'OFFICE', label: '办公用品' }, { value: 'CUSTOMIZED', label: '定制物品' }];
const actionLabels: Record<string, string> = { INBOUND: '入库', OUTBOUND: '领用出库', ADJUST: '盘点调整' };
const quantityText = (value: unknown) => value === null || value === undefined ? '—' : String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
const dateText = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(new Date(value)) : '—';
type Command = 'INBOUND' | 'OUTBOUND' | 'STOCKTAKE';

export default function InventoryPage() {
  const { pathname } = useLocation();
  const section = pathname.split('/')[2] || 'dashboard';
  const isItems = section === 'items', isStats = section.endsWith('statistics'), isDashboard = section === 'dashboard', isStocktake = section === 'stocktakes';
  const fixedKind: ItemKind | undefined = section.startsWith('customized') ? 'CUSTOMIZED' : section.startsWith('office') ? 'OFFICE' : undefined;
  const has = useAuthStore(s => s.hasPermission);
  const [rows, setRows] = useState<InventoryRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [dashboard, setDashboard] = useState<InventoryDashboard>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [filters, setFilters] = useState<InventoryQuery>({}), [draftFilters, setDraftFilters] = useState<InventoryQuery>({});
  const query: InventoryQuery = { ...filters, page, pageSize: 20, view: isItems ? 'items' : isStats ? 'statistics' : isStocktake ? 'stocktakes' : isDashboard ? 'dashboard' : 'movements', kind: fixedKind || filters.kind, action: section === 'inbound' ? 'INBOUND' : section === 'outbound' || section.endsWith('records') ? 'OUTBOUND' : undefined };
  const queryKey = JSON.stringify(query);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try {
      const q = JSON.parse(queryKey) as InventoryQuery;
      if (q.view === 'dashboard') { const res = await inventoryApi.dashboard(q); if (current === generation.current) setDashboard(res.data); }
      else { const res = await inventoryApi.list(q); if (current === generation.current) { setRows(res.data.list); setTotal(res.data.total); } }
    } catch { if (current === generation.current) setError('物品台账加载失败，请重试'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [queryKey]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; invalidate(); }; }, [load, invalidate]);

  const [itemOpen, setItemOpen] = useState(false), [editing, setEditing] = useState<InventoryItem>(), [busy, setBusy] = useState(false);
  const [itemForm] = Form.useForm();
  const [command, setCommand] = useState<Command>(), [selected, setSelected] = useState<InventoryItem>(), [itemOptions, setItemOptions] = useState<InventoryItem[]>([]), [recipients, setRecipients] = useState<InventoryRecipient[]>([]), [requestKey, setRequestKey] = useState('');
  const [commandForm] = Form.useForm();
  const itemSearchSequence = useRef(0), recipientSearchSequence = useRef(0);
  const searchItems = async (keyword?: string) => { const sequence = ++itemSearchSequence.current; try { const res = await inventoryApi.list({ view: 'items', status: 'ENABLED', kind: fixedKind, keyword, pageSize: 100 }); if (sequence === itemSearchSequence.current) setItemOptions(res.data.list as InventoryItem[]); } catch { message.error('物品选项加载失败'); } };
  const searchRecipients = async (keyword?: string) => { const sequence = ++recipientSearchSequence.current; try { const res = await inventoryApi.recipients(keyword); if (sequence === recipientSearchSequence.current) setRecipients(res.data); } catch { message.error('领用人加载失败'); } };
  const openItem = (row?: InventoryItem) => { setEditing(row); itemForm.resetFields(); itemForm.setFieldsValue(row ? { name: row.name, kind: row.kind, category: row.category, unit: row.unit, specification: row.specification, location: row.location, minimumStock: row.minimumStock, status: row.status } : { kind: fixedKind || 'OFFICE', unit: '个', minimumStock: '0', status: 'ENABLED' }); setItemOpen(true); };
  const openCommand = (action: Command, row?: InventoryItem) => {
    setCommand(action); setSelected(row); setRequestKey(crypto.randomUUID()); commandForm.resetFields(); commandForm.setFieldsValue({ itemId: row?.id, occurredAt: dayjs().format('YYYY-MM-DD') });
    if (row) setItemOptions([row]); else { setItemOptions([]); void searchItems(); }
    if (action === 'OUTBOUND') void searchRecipients();
  };
  const saveCommand = async (values: Record<string, unknown>) => {
    if (!selected || !command) return;
    setBusy(true);
    try {
      const data = { ...values, version: selected.version, idempotencyKey: requestKey };
      if (command === 'STOCKTAKE') await inventoryApi.stocktake(data); else await inventoryApi.move({ ...data, action: command });
      setCommand(undefined); await load(); message.success(command === 'STOCKTAKE' ? '盘点已保存，库存已核对' : '单据已保存，库存已更新');
    } catch (e) { showRequestError(e, '登记未完成，当前输入已保留；库存变化时请刷新后重新核对'); }
    finally { setBusy(false); }
  };
  const exportRows = async () => { setBusy(true); try { const res = await inventoryApi.export(query); downloadBlob(new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' }), res.data.fileName); } catch (e) { showRequestError(e, '导出失败'); } finally { setBusy(false); } };
  const columns = isItems ? [
    { title: '物品编码', dataIndex: 'code', width: 220 }, { title: '物品名称', dataIndex: 'name', width: 160 }, { title: '类型', key: 'kind', width: 105, render: (_: unknown, r: InventoryRow) => r.kind === 'CUSTOMIZED' ? '定制物品' : '办公用品' },
    { title: '分类', dataIndex: 'category', width: 110 }, { title: '规格', dataIndex: 'specification', width: 140 }, { title: '单位', dataIndex: 'unit', width: 75 }, { title: '存放位置', dataIndex: 'location', width: 150 },
    { title: '当前库存', key: 'stock', width: 110, render: (_: unknown, r: InventoryRow) => <Tag color={Number(r.stock) <= Number(r.minimumStock) ? 'orange' : 'green'}>{quantityText(r.stock)}</Tag> }, { title: '预警下限', dataIndex: 'minimumStock', width: 105, render: quantityText }, { title: '状态', key: 'status', width: 80, render: (_: unknown, r: InventoryRow) => r.status === 'ENABLED' ? '启用' : '停用' },
    { title: '操作', key: 'actions', width: 285, render: (_: unknown, r: InventoryRow) => <Space wrap>{has('inventory.manage') && <Button type="link" onClick={() => openItem(r as InventoryItem)}>编辑</Button>}{r.status === 'ENABLED' && <>{has('inventory.inbound') && <Button type="link" onClick={() => openCommand('INBOUND', r as InventoryItem)}>入库</Button>}{has('inventory.outbound') && <Button type="link" onClick={() => openCommand('OUTBOUND', r as InventoryItem)}>领用</Button>}{has('inventory.stocktake') && <Button type="link" onClick={() => openCommand('STOCKTAKE', r as InventoryItem)}>盘点</Button>}</>}</Space> },
  ] : isStats || isDashboard ? [
    { title: '物品名称', dataIndex: 'itemName', width: 200 }, { title: '领用人', dataIndex: 'employeeName', width: 130 }, { title: '领用组织', dataIndex: 'organizationPath', width: 300 }, { title: '领用数量', dataIndex: 'quantity', width: 120, render: quantityText }, { title: '单位', dataIndex: 'unit', width: 80 }, { title: '领用笔数', dataIndex: 'count', width: 110 },
  ] : isStocktake ? [
    { title: '盘点人', dataIndex: 'createdByName', width: 120 },
    { title: '盘点单号', dataIndex: 'documentNo', width: 220 }, { title: '物品名称', dataIndex: 'itemName', width: 180 }, { title: '盘点日期', dataIndex: 'occurredAt', width: 130, render: dateText }, { title: '账面库存', dataIndex: 'bookStock', width: 110, render: quantityText }, { title: '实盘数量', dataIndex: 'actualStock', width: 110, render: quantityText }, { title: '盈亏数量', dataIndex: 'difference', width: 110, render: quantityText }, { title: '单位', dataIndex: 'unit', width: 80 }, { title: '差异原因', dataIndex: 'reason', width: 270 },
  ] : [
    { title: '经办人', dataIndex: 'createdByName', width: 120 },
    { title: '单据编号', dataIndex: 'documentNo', width: 220 }, { title: '物品名称', dataIndex: 'itemName', width: 160 }, { title: '业务日期', dataIndex: 'occurredAt', width: 130, render: dateText }, { title: '业务类型', key: 'action', width: 110, render: (_: unknown, r: InventoryRow) => actionLabels[r.action || ''] }, { title: '数量', key: 'quantity', width: 100, render: (_: unknown, r: InventoryRow) => quantityText(r.action === 'OUTBOUND' ? String(r.quantity).replace(/^-/, '') : r.quantity) }, { title: '单位', dataIndex: 'unit', width: 80 }, { title: '领用人', dataIndex: 'employeeName', width: 120 }, { title: '领用组织', dataIndex: 'organizationPath', width: 290 }, { title: '来源/供应商', dataIndex: 'source', width: 180 }, { title: '用途/原因', dataIndex: 'reason', width: 240 }, { title: '操作后库存', dataIndex: 'afterStock', width: 120, render: quantityText },
  ];
  return <div>
    <h2>{titles[section] || '物品管理'}</h2>
    <p>实际领用与出库共用同一单据。库存调整需通过入库、领用或盘点登记，历史记录保留。</p>
    <Space wrap style={{ marginBottom: 16 }}>
      <Input aria-label="物品查询" placeholder="物品名称、编码或领用人" value={draftFilters.keyword || ''} onChange={e => setDraftFilters({ ...draftFilters, keyword: e.target.value })} style={{ width: 240 }} />
      {!fixedKind && <Select aria-label="物品类型筛选" placeholder="全部物品类型" allowClear value={draftFilters.kind} options={kindOptions} style={{ width: 160 }} onChange={kind => setDraftFilters({ ...draftFilters, kind })} />}
      {!isItems && <><Input aria-label="开始日期" type="date" value={draftFilters.from || ''} onChange={e => setDraftFilters({ ...draftFilters, from: e.target.value })} /><Input aria-label="结束日期" type="date" value={draftFilters.to || ''} onChange={e => setDraftFilters({ ...draftFilters, to: e.target.value })} /></>}
      {isStats && <Select aria-label="统计维度" value={draftFilters.groupBy || 'item'} style={{ width: 150 }} options={[{ value: 'item', label: '按物品统计' }, { value: 'employee', label: '按领用人统计' }, { value: 'organization', label: '按部门统计' }]} onChange={groupBy => setDraftFilters({ ...draftFilters, groupBy })} />}
      <Button type="primary" onClick={() => { setFilters(draftFilters); setPage(1); }}>查询</Button><Button onClick={() => { setFilters({}); setDraftFilters({}); setPage(1); }}>重置</Button><Button onClick={() => void load()}>刷新</Button>
      {!isDashboard && has('inventory.export') && <Button loading={busy} onClick={() => void exportRows()}>导出当前筛选</Button>}
    </Space>
    <Space wrap style={{ marginBottom: 16, display: 'flex' }}>{isItems && has('inventory.manage') && <Button type="primary" onClick={() => openItem()}>新增物品</Button>}{section === 'inbound' && has('inventory.inbound') && <Button type="primary" onClick={() => openCommand('INBOUND')}>登记入库</Button>}{(section === 'outbound' || section.endsWith('records')) && has('inventory.outbound') && <Button type="primary" onClick={() => openCommand('OUTBOUND')}>登记领用</Button>}{isStocktake && has('inventory.stocktake') && <Button type="primary" onClick={() => openCommand('STOCKTAKE')}>新增盘点</Button>}</Space>
    {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
    {isDashboard && <><Row gutter={16} style={{ marginBottom: 20 }}>{[['物品种类', dashboard?.itemCount], ['低库存种类', dashboard?.lowStockCount], ['期间入库笔数', dashboard?.inboundCount], ['期间领用笔数', dashboard?.outboundCount]].map(([label, value]) => <Col key={String(label)} xs={12} md={6}><Card><Statistic title={label} value={value ?? 0} /></Card></Col>)}</Row><h3>领用物品（前 10 项，各自计量单位）</h3></>}
    <Table<InventoryRow> rowKey="id" columns={columns} dataSource={isDashboard ? dashboard?.top || [] : rows} loading={loading} locale={{ emptyText: '暂无物品记录' }} pagination={isDashboard ? false : { current: page, total, pageSize: 20, showSizeChanger: false, onChange: setPage }} />
    <Modal title={editing ? '编辑物品' : '新增物品'} open={itemOpen} onCancel={() => { if (!busy) setItemOpen(false); }} onOk={() => itemForm.submit()} confirmLoading={busy} okButtonProps={{ disabled: busy }} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={itemForm} layout="vertical" onFinish={async values => { setBusy(true); try { await inventoryApi.saveItem({ ...values, ...(editing ? { version: editing.version } : {}) }, editing?.id); setItemOpen(false); await load(); message.success('物品资料已保存'); } catch (e) { showRequestError(e, '保存未完成，当前输入已保留'); } finally { setBusy(false); } }}>
        <Form.Item label="物品名称" name="name" rules={[{ required: true, whitespace: true, message: '请输入物品名称' }]}><Input aria-label="物品名称" maxLength={100} /></Form.Item>
        <Form.Item label="物品类型" name="kind" rules={[{ required: true }]}><Select aria-label="物品类型" options={kindOptions} /></Form.Item>
        <Form.Item label="中文分类" name="category" rules={[{ required: true, whitespace: true, message: '请输入中文分类' }]}><Input aria-label="中文分类" maxLength={100} placeholder="如书写用品、定制礼品" /></Form.Item>
        <Form.Item label="计量单位" name="unit" rules={[{ required: true, whitespace: true, message: '请输入计量单位' }]}><Input aria-label="计量单位" maxLength={20} /></Form.Item>
        <Form.Item label="规格型号" name="specification"><Input maxLength={100} /></Form.Item><Form.Item label="存放位置" name="location"><Input maxLength={100} /></Form.Item>
        <Form.Item label="库存预警下限" name="minimumStock"><InputNumber aria-label="库存预警下限" stringMode min="0" precision={3} /></Form.Item><Form.Item label="状态" name="status"><Select options={[{ value: 'ENABLED', label: '启用' }, { value: 'DISABLED', label: '停用' }]} /></Form.Item>
        <Alert type="info" title="新物品库存为 0，请另登记入库。已有流水后，物品类型和计量单位不可改动。" />
      </Form>
    </Modal>
    <Modal title={command === 'STOCKTAKE' ? '物品盘点' : command === 'INBOUND' ? '登记物品入库' : '登记物品领用'} open={!!command} onCancel={() => { if (!busy) setCommand(undefined); }} onOk={() => commandForm.submit()} confirmLoading={busy} okButtonProps={{ disabled: !selected || busy }} okText="确认登记" cancelText="取消" destroyOnHidden>
      <Form form={commandForm} layout="vertical" onFinish={saveCommand}>
        <Form.Item label="选择物品" name="itemId" rules={[{ required: true, message: '请选择物品' }]}><Select aria-label="选择物品" showSearch filterOption={false} onSearch={value => void searchItems(value)} onChange={id => setSelected(itemOptions.find(i => i.id === id))} options={itemOptions.map(i => ({ value: i.id, label: i.name + ' / ' + (i.specification || i.code) + ' / 库存 ' + quantityText(i.stock) + i.unit }))} /></Form.Item>
        {selected && <Alert type="info" title={'账面库存：' + quantityText(selected.stock) + ' ' + selected.unit} style={{ marginBottom: 12 }} />}
        <Form.Item label={command === 'STOCKTAKE' ? '实盘数量' : '数量'} name={command === 'STOCKTAKE' ? 'actualStock' : 'quantity'} rules={[{ required: true, message: '请输入数量' }]}><InputNumber aria-label={command === 'STOCKTAKE' ? '实盘数量' : '数量'} stringMode min={command === 'STOCKTAKE' ? '0' : '0.001'} precision={3} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="业务日期" name="occurredAt" rules={[{ required: true, message: '请选择日期' }]}><Input aria-label="业务日期" type="date" /></Form.Item>
        {command === 'OUTBOUND' && <Form.Item label="领用人" name="employeeId" rules={[{ required: true, message: '请选择在职领用人' }]}><Select aria-label="领用人" showSearch filterOption={false} onSearch={value => void searchRecipients(value)} options={recipients.map(r => ({ value: r.id, label: r.name + '（' + r.employeeNo + '） / ' + r.organizationPath }))} /></Form.Item>}
        {command === 'INBOUND' && <Form.Item label="来源/供应商" name="source"><Input maxLength={200} /></Form.Item>}
        <Form.Item label={command === 'STOCKTAKE' ? '差异原因（有差异必填）' : '用途/备注'} name="reason" rules={command === 'OUTBOUND' ? [{ required: true, whitespace: true, message: '请输入领用用途' }] : []}><Input.TextArea aria-label="用途或原因" maxLength={500} /></Form.Item>
        <Alert type="warning" title="确认后更新库存并保留历史单据。盘点期间库存有变化时须重新核对，不会覆盖新的出入库。" />
      </Form>
    </Modal>
  </div>;
}
