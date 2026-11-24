import FilePreviewButton from '@/features/files/FilePreviewButton';
import RecordPicker from './RelationPicker';
import type { RelationSnapshots } from '../../../../../server/app/domain/workflow/relation-display';
import { Button, DatePicker, Input, InputNumber, Select, Space, Upload, message } from 'antd';
import dayjs from 'dayjs';
import {
  calculate,
  matches,
  upload,
  download,
  errorText,
  type FormField,
  type Values,
  type Option,
} from './api';

export { default as RecordPicker } from './RelationPicker';
export default function WorkflowForm({
  fields,
  values,
  onChange,
  editable,
  users,
  instanceId,
  relationSnapshots,
  preview = false,
}: {
  fields: FormField[];
  values: Values;
  onChange: (v: Values) => void;
  editable: string[];
  users: Option[];
  instanceId?: string;
  relationSnapshots?: RelationSnapshots;
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
                    key={f.key + f.tableId}
                    field={f}
                    saved={relationSnapshots?.[f.key]}
                    tableId={f.tableId}
                    disabled={disabled}
                    value={value as string}
                    onChange={(v) => change(f.key, v ?? null)}
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
