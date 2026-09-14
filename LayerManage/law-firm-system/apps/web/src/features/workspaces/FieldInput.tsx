import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, InputNumber, Select, Space, Upload, message } from 'antd';
import { post, errorMessage } from './api';
import AttachmentItem from './AttachmentItem';
import type { Directory, Field, QueryResult } from './types';

export default function FieldInput({
  field,
  value,
  onChange,
  directory,
  tableId,
  disabled,
}: {
  field: Field;
  value: unknown;
  onChange(value: unknown): void;
  directory: Directory;
  tableId: string;
  disabled?: boolean;
}) {
  const [relations, setRelations] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    if (field.type === 'RELATION' && field.options.targetTableId)
      void post<QueryResult>('/tables/' + field.options.targetTableId + '/records/query', { pageSize: 200 })
        .then((r) => {
          if (alive)
            setRelations(
              r.records.map((row) => ({
                value: row.id,
                label: String(Object.values(row.values).find((v) => typeof v === 'string') ?? row.id),
              })),
            );
        })
        .catch(() => {
          if (alive) setRelations([]);
        });
    return () => {
      alive = false;
    };
  }, [field.type, field.options.targetTableId]);
  if (field.type === 'BOOLEAN')
    return (
      <Checkbox disabled={disabled} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)}>
        {field.name}
      </Checkbox>
    );
  if (field.type === 'NUMBER' || field.type === 'CURRENCY')
    return (
      <InputNumber
        aria-label={field.name}
        disabled={disabled}
        style={{ width: '100%' }}
        stringMode={field.type === 'CURRENCY'}
        precision={field.type === 'CURRENCY' ? 2 : undefined}
        value={value as string | number | null}
        onChange={onChange}
      />
    );
  if (['SINGLE_SELECT', 'MULTI_SELECT', 'USER', 'ORGANIZATION', 'RELATION'].includes(field.type)) {
    const opts =
      field.type === 'USER'
        ? directory.employees
        : field.type === 'ORGANIZATION'
          ? directory.organizations
          : field.options.choices || [];
    return (
      <Select
        aria-label={field.name}
        disabled={disabled}
        style={{ width: '100%' }}
        allowClear
        showSearch
        optionFilterProp="label"
        mode={['MULTI_SELECT', 'RELATION'].includes(field.type) ? 'multiple' : undefined}
        value={value as string | string[] | undefined}
        onChange={(v) => onChange(v ?? null)}
        options={field.type === 'RELATION' ? relations : opts.map((o) => ({ value: o.id, label: o.name }))}
      />
    );
  }
  if (field.type === 'FILE') {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Space orientation="vertical">
        <Upload
          disabled={disabled}
          showUploadList={false}
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx"
          beforeUpload={async (file) => {
            if (file.size > 10 * 1024 * 1024) {
              message.error('附件最大 10 MB');
              return false;
            }
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const uploaded = await post<{ id: string; name: string }>('/tables/' + tableId + '/files', {
                name: file.name,
                content: data,
              });
              onChange([...ids, uploaded.id]);
            } catch (error) {
              message.error(errorMessage(error));
            }
            return false;
          }}
        >
          <Button disabled={disabled}>上传附件</Button>
        </Upload>
        {ids.map((id) => (
          <Space key={id}>
            <AttachmentItem tableId={tableId} id={id} />
            {!disabled && (
              <Button size="small" onClick={() => onChange(ids.filter((f) => f !== id))}>
                移除
              </Button>
            )}
          </Space>
        ))}
      </Space>
    );
  }
  if (field.type === 'LONG_TEXT')
    return (
      <Input.TextArea
        aria-label={field.name}
        disabled={disabled}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }}
      />
    );
  if (field.type === 'DATE' || field.type === 'DATETIME')
    return (
      <Input
        aria-label={field.name}
        disabled={disabled}
        type={field.type === 'DATE' ? 'date' : 'datetime-local'}
        value={
          typeof value === 'string'
            ? field.type === 'DATE'
              ? value.slice(0, 10)
              : new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)
            : ''
        }
        onChange={(e) =>
          onChange(
            field.type === 'DATE'
              ? e.target.value
              : e.target.value
                ? new Date(e.target.value).toISOString()
                : null,
          )
        }
      />
    );
  return (
    <Input
      aria-label={field.name}
      disabled={disabled || !field.writable}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
