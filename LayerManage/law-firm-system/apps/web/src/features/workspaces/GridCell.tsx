import { useState } from 'react';
import { Button, Space, message } from 'antd';
import AttachmentItem from './AttachmentItem';
import FieldInput from './FieldInput';
import { displayValue } from './display-value';
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
  onDirty(dirty: boolean): void;
  onSaved(): void;
  onConflict(draft: unknown, remote: RecordRow): void;
}) {
  const [draft, setDraft] = useState<{ value: unknown; version: number; schema: number; key: string }>();
  const [saving, setSaving] = useState(false);
  const begin = () => {
    if (canBegin && field.writable && row.writable !== false) {
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
        <Button size="small" disabled={!field.writable || row.writable === false} onClick={begin}>
          编辑附件
        </Button>
      </div>
    );
  return (
    <button
      className="workspace-cell"
      data-record-id={row.id}
      data-field-id={field.id}
      style={{ minHeight: height }}
      aria-label={
        field.name +
        '：' +
        ((row.displayValues?.[field.id] ?? displayValue(field, row.values[field.id], directory)) || '空')
      }
      onClick={begin}
      onDoubleClick={begin}
      title={field.writable && row.writable !== false ? "双击编辑，回车保存，Esc 取消" : "只读字段"}
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
      {(row.displayValues?.[field.id] ?? displayValue(field, row.values[field.id], directory)) || (
        <span className="workspace-muted">—</span>
      )}
    </button>
  );
}
