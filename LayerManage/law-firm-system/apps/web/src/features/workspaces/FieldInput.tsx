import MedicalCustomerSelect from './MedicalCustomerSelect';
import LifecycleSelect from './LifecycleSelect';
import SealReviewInput from './SealReviewInput';
import ReceiptDetails from './ReceiptDetails';
import { isInventoryDecimal } from './inventory-decimal';
import { displayValue, isCasePercent } from './display-value';
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
  displayText,
  onPreview,
}: {
  field: Field;
  value: unknown;
  onChange(value: unknown): void;
  directory: Directory;
  tableId: string;
  disabled?: boolean;
  displayText?: string;
  onPreview?(values: Record<string, unknown>): void;
}) {
  const [relations, setRelations] = useState<{ value: string; label: string }[]>([]);
  const [relationKeyword, setRelationKeyword] = useState('');
  const selectedIds = JSON.stringify(Array.isArray(value) ? value : []);
  useEffect(() => {
    let alive = true;
    if (field.type === 'RELATION' && field.options.targetSource) {
      const timer = setTimeout(() => {
        void post<{options:{id:string;label:string}[]}>('/tables/'+tableId+'/fields/'+field.id+'/relation-options',
          {keyword:relationKeyword, selectedIds:JSON.parse(selectedIds)})
          .then(result => { if(alive) setRelations(result.options.map(row=>({value:row.id,label:row.label}))); })
          .catch(() => {if(alive) setRelations([]);});
      }, 200);
      return () => {alive=false;clearTimeout(timer);};
    }
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
  }, [field.id, field.type, field.options.targetTableId, field.options.targetSource, tableId, relationKeyword, selectedIds]);
  if(field.options.medicalRelation)return <MedicalCustomerSelect tableId={tableId} value={value} disabled={disabled||!field.writable} onChange={onChange} onPreview={onPreview}/>;
  if (field.options.businessKey === 'receiptDetails') return <ReceiptDetails value={value} tableId={tableId}/>;
  if (field.options.hrPartialDate) return <Input aria-label={field.name} disabled={disabled || !field.writable} placeholder="YYYY-MM 或 YYYY-MM-DD" value={value==null?'':String(value).includes('T')?displayValue(field,value,directory).replace(/\//g,'-'):String(value)} onChange={e=>onChange(e.target.value||null)}/>;
  if (field.options.hrSensitive && !field.writable) return <Input disabled value={Array.isArray(value)?'':String(value??'')}/>;
  if (field.options.adminReview) return <SealReviewInput value={value} onChange={onChange} disabled={disabled || !field.writable}/>;
  if (field.options.lifecycleKey === 'upstreamId')
    return (
      <LifecycleSelect
        tableId={tableId}
        value={value}
        onChange={onChange}
        disabled={disabled || !field.writable}
        label={displayText}
        onPreview={onPreview}
      />
    );
  if (disabled && field.type === 'FILE')
    return <Space orientation="vertical">{(Array.isArray(value) ? value : []).map(id =>
      <AttachmentItem key={String(id)} tableId={tableId} id={String(id)} />)}</Space>;
  if (['AUTONUMBER', 'FORMULA', 'CREATED_BY', 'UPDATED_BY', 'CREATED_AT', 'UPDATED_AT'].includes(field.type) || disabled && (field.options.businessKey || field.options.lifecycleKey))
    return <Input disabled value={displayText ?? displayValue(field, value, directory)} />;
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
        disabled={disabled || !!field.options.prospectAssignee && !field.writable}
        style={{ width: '100%' }}
        stringMode={
          field.type === 'CURRENCY' ||
          isInventoryDecimal(field) ||
          field.options.businessKey?.startsWith('intake.')
        }
        precision={
          field.options.nonnegativeInteger || field.options.businessKey === 'intake.managementFeeRatio'
            ? 0
            : field.type === 'CURRENCY' || isCasePercent(field)
              ? 2
              : isInventoryDecimal(field)
                ? 3
                : undefined
        }
        min={isCasePercent(field) || field.options.nonnegativeInteger ? 0 : undefined}
        max={isCasePercent(field) ? 100 : undefined}
        suffix={isCasePercent(field) ? '%' : field.type === 'CURRENCY' ? '元' : undefined}
        formatter={field.options.numberFormat === 'CNY' ? (value, info) => info.userTyping ? info.input : String(value ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : undefined}
        parser={field.options.numberFormat === 'CNY' ? value => (value ?? '').replace(/,/g, '') : undefined}
        value={value as string | number | null}
        onChange={onChange}
      />
    );
  if (['SINGLE_SELECT', 'MULTI_SELECT', 'USER', 'ORGANIZATION', 'RELATION'].includes(field.type)) {
    const opts =
      field.options.businessKey === 'intake.handlingLawyer'
        ? directory.employees.map(e => ({ ...e, label: e.employeeNo ? e.name + ' · ' + e.employeeNo : e.name }))
        : field.type === 'USER'
        ? field.options.prospectAssignee ? field.options.choices ?? [] : directory.employees
        : field.type === 'ORGANIZATION'
          ? directory.organizations
          : field.options.choices || [];
    return (
      <Select
        aria-label={field.name}
        disabled={disabled || !!field.options.prospectAssignee && !field.writable}
        style={{ width: '100%' }}
        allowClear
        labelRender={field.options.businessKey === 'intake.handlingLawyer'
          ? ({ value, label }) => label ?? displayText ?? String(value ?? '') : undefined}
        placeholder={field.options.businessKey === 'intake.handlingLawyer' ? '搜索姓名或工号，选择承办律师' : undefined}
        showSearch
        optionFilterProp="label"
        filterOption={field.options.targetSource ? false : undefined}
        onSearch={field.options.targetSource ? setRelationKeyword : undefined}
        mode={['MULTI_SELECT', 'RELATION'].includes(field.type) ? 'multiple' : undefined}
        value={value as string | string[] | undefined}
        onChange={(v) => onChange(v ?? null)}
        options={field.type === 'RELATION' ? relations : opts.map((o) => ({ value: o.id, label: o.label ?? o.name }))}
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
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx,.mp3,.wav,.m4a"
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
        type={field.type === 'DATE' || field.options.dateOnly ? 'date' : 'datetime-local'}
        value={
          typeof value === 'string'
            ? field.options.dateOnly || field.options.dateMinute ? displayValue(field, value, directory).replace(/\//g, '-').replace(' ', 'T') : field.type === 'DATE'
              ? value.slice(0, 10)
              : new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)
            : ''
        }
        onChange={(e) =>
          onChange(
            field.options.dateOnly
              ? (e.target.value ? new Date(e.target.value + 'T00:00:00+08:00').toISOString() : null)
              : field.options.dateMinute
              ? (e.target.value ? new Date(e.target.value + '+08:00').toISOString() : null)
              : field.type === 'DATE'
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
