import { useState } from 'react';
import ReceiptDetails from './ReceiptDetails';
import { Button, Space, message } from 'antd';
import AttachmentItem from './AttachmentItem';
import FieldInput from './FieldInput';
import { displayValue, fieldHint } from './display-value';
import { errorMessage, errorStatus, get, patch } from './api';
import type { Directory, Field, RecordDetail, RecordRow } from './types';

export default function GridCell({
  row,
  field,
  directory,
  tableId,
  schemaVersion,
  height,
  canBegin = true,
  businessSource,
  onBusinessAction,
  onDirty,
  onSaved,
  onConflict,
}: {
  row: RecordRow;
  field: Field;
  directory: Directory;
  tableId: string;
  schemaVersion: number;
  height: number;
  canBegin?: boolean;
  businessSource?: string;
  onBusinessAction?(): void;
  onDirty(dirty: boolean): void;
  onSaved(): void;
  onConflict(draft: unknown, remote: RecordRow): void;
}) {
  const [draft, setDraft] = useState<{ value: unknown; version: number; schema: number; key: string }>();
  const [saving, setSaving] = useState(false);
  const editable = field.writable && row.writable !== false && !row.readonlyFields?.includes(field.id);
  const workflow = Boolean(
    field.options.businessKey &&
      ['status', 'approvalId', 'receivedAmount', 'stock', 'score', 'bonus'].includes(
        field.options.businessKey,
      ),
  );
  const financeReadonly = ['receiptDetails','receiptTotal','receiptFiles'].includes(field.options.businessKey || '') || ['actualRefundAmount','refundPaidAt','refundStatus','refundReceiptLookup'].includes(field.options.lifecycleKey || '');
  const readonlyReason = financeReadonly ? '财务数据仅限财务部录入，此处为自动同步' : row.readonlyFields?.includes(field.id)
    ? '此字段从关联合同或客户档案同步，请在来源记录中维护。'
    : !field.writable
    ? field.options.lifecycleKey ? fieldHint(field) : field.options.businessKey
      ? workflow
        ? '此字段由业务流程维护，点击办理；系统将校验操作权限和状态。'
        : '业务关联或系统字段只读；可在详情中查看相关资料。'
      : '系统字段或当前字段权限为只读。'
    : '当前记录状态或数据权限不允许修改，请打开业务详情办理。';
  const begin = () => {
    if (canBegin && editable) {
      setDraft({
        value: row.values[field.id],
        version: row.version,
        schema: schemaVersion,
        key: crypto.randomUUID(),
      });
      onDirty(true);
    }
  };
  const close = () => {
    setDraft(undefined);
    onDirty(false);
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await patch(
        '/tables/' + tableId + '/records/' + row.id,
        { values: { [field.id]: draft.value ?? null }, version: draft.version, schemaVersion: draft.schema },
        draft.key,
      );
      close();
      onSaved();
    } catch (e) {
      message.error(errorMessage(e));
      if (errorStatus(e) === 409) {
        try {
          const latest = await get<RecordDetail>('/tables/' + tableId + '/records/' + row.id);
          onConflict(draft.value, latest.record);
          close();
        } catch {
          /* Keep the draft available for retry. */
        }
      } else if (errorStatus(e)) setDraft((old) => (old ? { ...old, key: crypto.randomUUID() } : old));
    } finally {
      setSaving(false);
    }
  };
  if (field.options.businessKey === 'receiptDetails') return <ReceiptDetails value={row.values[field.id]} tableId={tableId}/>;
  if (draft)
    return (
      <div
        className="workspace-cell-editor"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            (e.ctrlKey ||
              e.metaKey ||
              (e.target instanceof HTMLInputElement && !e.target.closest('.ant-select')))
          ) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <FieldInput
          field={field}
          value={draft.value}
          directory={directory}
          tableId={tableId}
          disabled={saving}
          onChange={(value) => setDraft((d) => (d ? { ...d, value, key: crypto.randomUUID() } : d))}
        />
        <Space>
          <Button
            size="small"
            type="primary"
            loading={saving}
            onClick={() => {
              void save();
            }}
          >
            保存
          </Button>
          <Button size="small" onClick={close}>
            取消
          </Button>
        </Space>
      </div>
    );
  if (
    field.type === 'FILE' &&
    Array.isArray(row.values[field.id]) &&
    (row.values[field.id] as string[]).length
  )
    return (
      <div onDoubleClick={begin}>
        {(row.values[field.id] as string[]).slice(0, 3).map((id) => (
          <AttachmentItem key={id} tableId={tableId} id={id} />
        ))}
        <Button size="small" disabled={!editable} onClick={begin}>
          编辑附件
        </Button>
      </div>
    );
  return (
    <button
      className="workspace-cell"
      data-record-id={row.id}
      data-field-id={field.id}
      style={{ minHeight: height, ...(!editable ? { backgroundColor: '#f5f5f5', color: '#737373' } : {}) }}
      aria-label={
        field.name +
        '：' +
        ((row.displayValues?.[field.id] ?? displayValue(field, row.values[field.id], directory)) || '空')
      }
      onClick={editable ? begin : workflow && businessSource ? onBusinessAction : undefined}
      onDoubleClick={financeReadonly ? ()=>message.info('财务数据仅限财务部录入，此处为自动同步') : editable ? begin : workflow && businessSource ? onBusinessAction : undefined}
      title={editable ? '双击编辑，回车保存，Esc 取消' : readonlyReason}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          begin();
        }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          const cell = e.currentTarget.closest('.ant-table-cell');
          const line = cell?.parentElement;
          const index = line && cell ? Array.from(line.children).indexOf(cell) : -1;
          const next =
            e.key === 'ArrowLeft'
              ? cell?.previousElementSibling
              : e.key === 'ArrowRight'
                ? cell?.nextElementSibling
                : (e.key === 'ArrowUp' ? line?.previousElementSibling : line?.nextElementSibling)?.children[
                    index
                  ];
          const button = next?.querySelector<HTMLButtonElement>('.workspace-cell');
          if (button) {
            e.preventDefault();
            button.focus();
          }
        }
      }}
    >
      {!editable && workflow && onBusinessAction && (
        <span style={{ color: '#1677ff', marginRight: 6 }}>办理</span>
      )}
      {(row.displayValues?.[field.id] ?? displayValue(field, row.values[field.id], directory)) || (
        <span className="workspace-muted">—</span>
      )}
    </button>
  );
}
