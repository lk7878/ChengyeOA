import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  message,
} from 'antd';
import Modal from '@/components/DraggableModal';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { inventoryApi, type InventoryItem, type InventoryRow } from '@/api/inventory';
import { requestErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { BusinessTableLinks } from '@/features/crm/BusinessWorkspacePage';
import FinanceChoicePicker, { type ChoiceLoader } from '@/pages/finance/FinanceChoicePicker';

type Source = 'items' | 'movements' | 'stocktakes';
type Action = 'EDIT' | 'INBOUND' | 'OUTBOUND' | 'STOCKTAKE';
const sources = {
  items: 'INVENTORY_ITEMS',
  movements: 'INVENTORY_MOVEMENTS',
  stocktakes: 'INVENTORY_STOCKTAKES',
} as const;
const titles = { EDIT: '编辑物品', INBOUND: '登记入库', OUTBOUND: '登记领用', STOCKTAKE: '物品盘点' };
const fields: [string, string][] = [
  ['code', '物品编号'],
  ['documentNo', '单据编号'],
  ['name', '物品名称'],
  ['itemName', '物品名称'],
  ['category', '分类'],
  ['specification', '规格'],
  ['unit', '计量单位'],
  ['location', '存放位置'],
  ['stock', '当前库存'],
  ['minimumStock', '预警下限'],
  ['quantity', '变动数量'],
  ['beforeStock', '变动前库存'],
  ['afterStock', '变动后库存'],
  ['bookStock', '账面库存'],
  ['actualStock', '实盘数量'],
  ['difference', '盘点差异'],
  ['employeeName', '领用人'],
  ['organizationPath', '领用组织'],
  ['source', '来源供应商'],
  ['reason', '用途原因'],
  ['createdByName', '登记人'],
];
export default function InventoryRecordPage({
  source,
  creating = false,
}: {
  source: Source;
  creating?: boolean;
}) {
  const { id = '' } = useParams();
  return <InventoryRecord key={source + id + creating} source={source} id={id} creating={creating} />;
}
function InventoryRecord({ source, id, creating }: { source: Source; id: string; creating: boolean }) {
  const navigate = useNavigate(),
    [params] = useSearchParams();
  const has = useAuthStore((s) => s.hasPermission);
  const [row, setRow] = useState<InventoryRow>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ action: Action; item?: InventoryItem }>();
  const [form] = Form.useForm();
  const [chosen, setChosen] = useState<InventoryItem>();
  const alive = useRef(true),
    sequence = useRef(0),
    selectedSequence = useRef(0);
  const attempt = useRef<{ body: string; key: string } | undefined>(undefined);
  const [creationAction, setCreationAction] = useState<Action>(
    source === 'stocktakes'
      ? 'STOCKTAKE'
      : params.get('action') === 'OUTBOUND' && has('inventory.outbound')
        ? 'OUTBOUND'
        : has('inventory.inbound')
          ? 'INBOUND'
          : 'OUTBOUND',
  );
  const action = creating ? (source === 'items' ? 'EDIT' : creationAction) : draft?.action;
  const refresh = useCallback(async () => {
    if (creating) return;
    const seq = ++sequence.current;
    try {
      const next = (await inventoryApi.detail(source, id)).data;
      if (alive.current && seq === sequence.current) {
        setRow(next);
        setError('');
      }
    } catch (e) {
      if (alive.current && seq === sequence.current) {
        setError(requestErrorMessage(e));
        const status = (e as { response?: { status?: number } }).response?.status;
        if ([401, 403, 404].includes(status ?? 0)) {
          setRow(undefined);
          setDraft(undefined);
        }
      }
    }
  }, [source, id, creating]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const loadItems = useCallback<ChoiceLoader>(async (page, keyword) => {
    const data = (await inventoryApi.list({ view: 'items', status: 'ENABLED', page, pageSize: 20, keyword }))
      .data;
    return {
      total: data.total,
      list: data.list.map((i) => ({
        id: i.id,
        label: i.name + ' / ' + i.code + ' / 库存 ' + i.stock + i.unit,
      })),
    };
  }, []);
  const loadRecipients = useCallback<ChoiceLoader>(async (page, keyword) => {
    const data = (await inventoryApi.recipientPage(page, keyword)).data;
    return {
      total: data.total,
      list: data.list.map((e) => ({
        id: e.id,
        label: e.name + ' / ' + e.employeeNo + ' / ' + e.organizationPath,
      })),
    };
  }, []);
  const selectItem = async (itemId?: string) => {
    const seq = ++selectedSequence.current;
    setChosen(undefined);
    if (!itemId) return;
    try {
      const next = (await inventoryApi.detail('items', itemId)).data as InventoryItem;
      if (alive.current && seq === selectedSequence.current) setChosen(next);
    } catch (e) {
      if (alive.current && seq === selectedSequence.current) setError(requestErrorMessage(e));
    }
  };
  const open = (next: Action) => {
    if (!row) return;
    const item = row as InventoryItem;
    attempt.current = undefined;
    setDraft({ action: next, item });
    setChosen(item);
    form.resetFields();
    form.setFieldsValue(
      next === 'EDIT' ? item : { occurredAt: new Date().toISOString().slice(0, 10), itemId: item.id },
    );
  };
  const save = async (values: Record<string, unknown>) => {
    if (!action || busy) return;
    const item = creating ? chosen : draft?.item;
    if (action !== 'EDIT' && !item) return;
    const data =
      action === 'EDIT'
        ? { ...values, ...(!creating && item ? { version: item.version } : {}) }
        : {
            ...values,
            itemId: item!.id,
            version: item!.version,
            ...(action !== 'STOCKTAKE' ? { action } : {}),
          };
    const body = JSON.stringify(data);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const command = { ...data, idempotencyKey: attempt.current!.key };
      const result =
        action === 'EDIT'
          ? await inventoryApi.saveItem(command, creating ? undefined : id)
          : action === 'STOCKTAKE'
            ? await inventoryApi.stocktake(command)
            : await inventoryApi.move(command);
      if (!alive.current) return;
      message.success('登记已保存');
      setDraft(undefined);
      if (creating)
        navigate(
          '/inventory/' +
            (action === 'EDIT' ? 'items' : action === 'STOCKTAKE' ? 'stocktakes' : 'movements') +
            '/' +
            result.data.id + (params.size ? '?' + params.toString() : ''),
        );
      else await refresh();
    } catch (e) {
      if (alive.current) setError(requestErrorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const allowed =
    action === 'EDIT'
      ? has('inventory.manage')
      : action === 'STOCKTAKE'
        ? has('inventory.stocktake')
        : action === 'INBOUND'
          ? has('inventory.inbound')
          : has('inventory.outbound');
  const editor = (
    <Form
      form={form}
      layout="vertical"
      onFinish={save}
      initialValues={{
        kind: 'OFFICE',
        unit: '个',
        minimumStock: '0',
        status: 'ENABLED',
        occurredAt: new Date().toISOString().slice(0, 10),
      }}
    >
      {action === 'EDIT' ? (
        <>
          <Form.Item label="物品名称" name="name" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="物品类型" name="kind" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'OFFICE', label: '办公用品' },
                { value: 'CUSTOMIZED', label: '定制物品' },
              ]}
            />
          </Form.Item>
          <Form.Item label="中文分类" name="category" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="计量单位" name="unit" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item label="规格型号" name="specification">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="存放位置" name="location">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="库存预警下限" name="minimumStock">
            <InputNumber stringMode min="0" precision={3} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              options={[
                { value: 'ENABLED', label: '启用' },
                { value: 'DISABLED', label: '停用' },
              ]}
            />
          </Form.Item>
          {creating && <p>新物品库存为 0，保存后可登记入库。</p>}
        </>
      ) : (
        <>
          {creating ? (
            <Form.Item label="选择物品" name="itemId" rules={[{ required: true }]}>
              <FinanceChoicePicker
                label="选择物品"
                load={loadItems}
                onPick={(choice) => void selectItem(choice?.id)}
              />
            </Form.Item>
          ) : (
            <p>{draft?.item?.name}</p>
          )}
          {chosen && <Alert type="info" title={'账面库存：' + chosen.stock + ' ' + chosen.unit} />}
          <Form.Item
            label={action === 'STOCKTAKE' ? '实盘数量' : '数量'}
            name={action === 'STOCKTAKE' ? 'actualStock' : 'quantity'}
            rules={[{ required: true }]}
          >
            <InputNumber
              stringMode
              min={action === 'STOCKTAKE' ? '0' : '0.001'}
              precision={3}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="业务日期" name="occurredAt" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          {action === 'OUTBOUND' && (
            <Form.Item label="领用人" name="employeeId" rules={[{ required: true }]}>
              <FinanceChoicePicker label="领用人" load={loadRecipients} />
            </Form.Item>
          )}
          {action === 'INBOUND' && (
            <Form.Item label="来源供应商" name="source">
              <Input maxLength={200} />
            </Form.Item>
          )}
          <Form.Item
            label="用途或原因"
            name="reason"
            rules={action === 'OUTBOUND' ? [{ required: true, whitespace: true }] : []}
          >
            <Input.TextArea maxLength={500} />
          </Form.Item>
          <Alert
            type="info"
            title="登记后保留历史单据。库存发生变化时，请核对最新库存后重新办理。盘点有差异时须填写原因。"
          />
        </>
      )}
      <Button
        style={{ marginTop: 16 }}
        type="primary"
        htmlType="submit"
        loading={busy}
        disabled={!allowed || (action !== 'EDIT' && !chosen)}
      >
        确认登记
      </Button>
    </Form>
  );
  const back = '/inventory/' + source + (params.size ? '?' + params.toString() : '');
  return (
    <div className="unified-area-page">
      <Link to={back}>返回工作表</Link>
      <h1>
        {creating
          ? source === 'items'
            ? '新增物品'
            : source === 'stocktakes'
              ? '新增盘点'
              : '登记出入库'
          : '物品业务详情'}
      </h1>
      {error && (
        <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>刷新重试</Button>} />
      )}
      {creating ? (
        <Card style={{ maxWidth: 760 }}>
          {source === 'movements' && (
            <Select
              aria-label="出入库类型"
              value={creationAction}
              style={{ width: 180, marginBottom: 16 }}
              options={[
                ...(has('inventory.inbound') ? [{ value: 'INBOUND', label: '登记入库' }] : []),
                ...(has('inventory.outbound') ? [{ value: 'OUTBOUND', label: '登记领用' }] : []),
              ]}
              onChange={(value) => {
                setCreationAction(value);
                form.resetFields();
                setChosen(undefined);
              }}
            />
          )}
          {!allowed && <Alert type="warning" title="当前岗位没有此操作权限。" />}
          {allowed && editor}
        </Card>
      ) : (
        <>
          {!row && !error && <Spin />}
          {row && (
            <>
              <Space wrap style={{ marginBottom: 16 }}>
                {source === 'items' && (
                  <>
                    {has('inventory.manage') && <Button onClick={() => open('EDIT')}>编辑物品</Button>}
                    {row.status === 'ENABLED' && (
                      <>
                        {has('inventory.inbound') && (
                          <Button onClick={() => open('INBOUND')}>登记入库</Button>
                        )}
                        {has('inventory.outbound') && (
                          <Button onClick={() => open('OUTBOUND')}>登记领用</Button>
                        )}
                        {has('inventory.stocktake') && (
                          <Button onClick={() => open('STOCKTAKE')}>物品盘点</Button>
                        )}
                      </>
                    )}
                  </>
                )}
                {source !== 'items' && row.itemId && (
                  <Link to={'/inventory/items/' + row.itemId}>查看物品</Link>
                )}
                <BusinessTableLinks source={sources[source]} recordId={id} />
              </Space>
              <Card>
                <Descriptions
                  column={{ xs: 1, md: 2 }}
                  items={fields
                    .filter(([key]) => (row as unknown as Record<string, unknown>)[key] != null)
                    .map(([key, label]) => ({
                      key,
                      label,
                      children: String((row as unknown as Record<string, unknown>)[key]),
                    }))}
                />
              </Card>
            </>
          )}
        </>
      )}
      {row && (
        <Modal
          open={!!draft}
          title={draft ? titles[draft.action] : ''}
          footer={null}
          onCancel={() => {
            if (!busy) setDraft(undefined);
          }}
          destroyOnHidden
        >
          {error && <Alert type="error" title={error} />}
          {draft && row?.version !== draft.item?.version && (
            <Alert
              type="warning"
              title="库存或物品资料已变化，草稿保留。请核对后使用最新版本。"
              action={
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft({ ...draft, item: row as InventoryItem });
                    setChosen(row as InventoryItem);
                    attempt.current = undefined;
                  }}
                >
                  已核对最新版本
                </Button>
              }
            />
          )}
          {draft && editor}
        </Modal>
      )}
    </div>
  );
}
