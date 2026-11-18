import FilePreviewButton from '@/features/files/FilePreviewButton';
import { useEffect, useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Select, Space, Upload, message } from 'antd';
import dayjs from 'dayjs';
import {
  calculate,
  matches,
  get,
  post,
  upload,
  download,
  errorText,
  type FormField,
  type Values,
  type Option,
  type TableSchema,
} from './api';

export function RecordPicker({
  tableId,
  value,
  onChange,
  disabled = false,
}: {
  tableId: string;
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Option[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    Promise.all([
      get<TableSchema>(`/tables/${tableId}`),
      post<{ records: Array<{ id: string; values: Values }>; total: number }>(
        `/tables/${tableId}/records/query`,
        { page, pageSize: 50 },
      ),
    ])
      .then(([schema, data]) => {
        if (!live) return;
        const primary = schema.fields[0]?.id;
        const next = data.records.map((r) => ({ id: r.id, name: String(r.values[primary] ?? r.id) }));
        setRows((old) => (page === 1 ? next : [...old, ...next]));
        setTotal(data.total);
      })
      .catch((e) => message.error(errorText(e)))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tableId, page]);
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Select
        style={{ width: '100%' }}
        disabled={disabled}
        loading={loading}
        showSearch
        optionFilterProp="label"
        value={value}
        onChange={onChange}
        placeholder="选择有权访问的业务记录"
        options={rows.map((r) => ({ value: r.id, label: r.name }))}
      />
      {!disabled && rows.length < total && (
        <Button loading={loading} onClick={() => setPage((p) => p + 1)}>
          加载更多
        </Button>
      )}
    </Space.Compact>
  );
}
export default function WorkflowForm({
  fields,
  values,
  onChange,
  editable,
  users,
  instanceId,
  preview = false,
}: {
  fields: FormField[];
  values: Values;
  onChange: (v: Values) => void;
  editable: string[];
  users: Option[];
  instanceId?: string;
  preview?: boolean;
}) {
  let display = values;
  try {
    display = calculate(fields, values);
  } catch {
    /* Invalid intermediate input stays editable. */
  }
  const change = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  return (
    <div className="wf-form">
      {fields
        .filter((f) => matches(f.visibleWhen, display))
        .map((f) => {
          const disabled = !editable.includes(f.key) || ['formula', 'moneyUpper'].includes(f.type),
            value = display[f.key];
          let control;
          switch (f.type) {
            case 'number':
              control = (
                <InputNumber
                  placeholder={f.placeholder}
                  style={{ width: '100%' }}
                  disabled={disabled}
                  value={value as number}
                  onChange={(v) => change(f.key, v)}
                />
              );
              break;
            case 'date':
              control = (
                <DatePicker
                  placeholder={f.placeholder}
                  style={{ width: '100%' }}
                  disabled={disabled}
                  value={value ? dayjs(String(value)) : null}
                  onChange={(d) => change(f.key, d?.format('YYYY-MM-DD') ?? null)}
                />
              );
              break;
            case 'select':
            case 'multi':
              control = (
                <Select
                  placeholder={f.placeholder}
                  style={{ width: '100%' }}
                  disabled={disabled}
                  allowClear
                  mode={f.type === 'multi' ? 'multiple' : undefined}
                  value={value as string & string[]}
                  onChange={(v) => change(f.key, v ?? null)}
                  options={f.options?.map((v) => ({ value: v, label: v }))}
                />
              );
              break;
            case 'user':
              control = (
                <Select
                  style={{ width: '100%' }}
                  disabled={disabled}
                  showSearch
                  optionFilterProp="label"
                  value={value as string}
                  onChange={(v) => change(f.key, v)}
                  options={users.map((u) => ({ value: u.id, label: u.name }))}
                />
              );
              break;
            case 'relation':
              control =
                !preview && f.tableId ? (
                  <RecordPicker
                    key={f.tableId}
                    tableId={f.tableId}
                    disabled={disabled}
                    value={value as string}
                    onChange={(v) => change(f.key, v)}
                  />
                ) : (
                  <Input disabled placeholder={preview ? '选择有权访问的业务记录' : '先配置关联表'} />
                );
              break;
            case 'file':
              control = (
                <Space direction="vertical">
                  {(Array.isArray(value) ? (value as string[]) : []).map((id, index) => (
                    <Space key={id}>
                      <FilePreviewButton name={`附件 ${index + 1}`} url={`/api/v1/workflows/files/${id}${instanceId ? '?instance=' + encodeURIComponent(instanceId) : ''}`}>预览附件 {index + 1}</FilePreviewButton>
                      <Button
                        onClick={() => download(id, instanceId).catch((e) => message.error(errorText(e)))}
                      >
                        下载附件 {index + 1}
                      </Button>
                      {!disabled && (
                        <Button
                          danger
                          onClick={() =>
                            change(
                              f.key,
                              (value as string[]).filter((x) => x !== id),
                            )
                          }
                        >
                          移除
                        </Button>
                      )}
                    </Space>
                  ))}
                  {!disabled && !preview && (
                    <Upload
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        if (file.size > 10 * 1024 * 1024) {
                          message.error('附件不能超过10MB');
                          return false;
                        }
                        upload(file)
                          .then((r) => change(f.key, [...(Array.isArray(value) ? value : []), r.id]))
                          .catch((e) => message.error(errorText(e)));
                        return false;
                      }}
                    >
                      <Button>上传附件（≤10MB）</Button>
                    </Upload>
                  )}
                  {preview && <Button disabled>上传附件（预览不上传）</Button>}
                </Space>
              );
              break;
            case 'detail':
              control = (
                <div className={'wf-details ' + (f.layout === 'horizontal' ? 'horizontal' : 'vertical')}>
                  {(Array.isArray(value) ? (value as Values[]) : []).map((row, index) => (
                    <div className="wf-detail-row" key={index}>
                      <strong>明细 {index + 1}</strong>
                      <WorkflowForm
                        fields={f.children ?? []}
                        values={row}
                        users={users}
                        preview={preview}
                        editable={disabled ? [] : (f.children ?? []).map((c) => c.key)}
                        onChange={(v) =>
                          change(
                            f.key,
                            (value as Values[]).map((r, i) => (i === index ? v : r)),
                          )
                        }
                      />
                      {!disabled && (
                        <Button
                          danger
                          onClick={() =>
                            change(
                              f.key,
                              (value as Values[]).filter((_, i) => i !== index),
                            )
                          }
                        >
                          删除此行
                        </Button>
                      )}
                    </div>
                  ))}
                  {!disabled && (
                    <Button
                      disabled={Array.isArray(value) && value.length >= 200}
                      onClick={() => change(f.key, [...(Array.isArray(value) ? value : []), {}])}
                    >
                      增加明细行
                    </Button>
                  )}
                </div>
              );
              break;
            case 'textarea':
              control = (
                <Input.TextArea
                  placeholder={f.placeholder}
                  rows={3}
                  disabled={disabled}
                  maxLength={f.maxLength ?? 2000}
                  value={value as string}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              );
              break;
            default:
              control = (
                <Input
                  placeholder={f.placeholder}
                  disabled={disabled}
                  maxLength={f.maxLength ?? 2000}
                  value={value == null ? '' : String(value)}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              );
          }
          return (
            <div className="wf-field" key={f.key}>
              <label>
                {(f.required || (f.requiredWhen && matches(f.requiredWhen, display))) && (
                  <span style={{ color: '#d4380d' }}>* </span>
                )}
                {f.label}
                {disabled && <small> · 只读</small>}
              </label>
              {control}
              {f.description && <p className="wf-field-help">{f.description}</p>}
            </div>
          );
        })}
    </div>
  );
}
