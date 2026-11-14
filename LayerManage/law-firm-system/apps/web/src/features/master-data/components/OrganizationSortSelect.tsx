import { Select } from 'antd';
import { useState } from 'react';
import type { OrganizationNode } from '../types';

import { nextOrganizationSort } from '../organization-utils';
export default function OrganizationSortSelect({ nodes, ownId, value, onChange, id }: {
  nodes: OrganizationNode[]; ownId?: string; value?: number; onChange?: (value: number) => void; id?: string;
}) {
  const [search, setSearch] = useState('');
  const occupied = new Map(nodes.filter(node => node.id !== ownId).map(node => [node.sort, node]));
  const next = nextOrganizationSort(nodes);
  const searched = /^\d+$/.test(search) ? Number(search) : undefined;
  const numbers = new Set([...Array.from({ length: 30 }, (_, i) => i), ...nodes.map(node => node.sort), next]);
  if (value !== undefined) numbers.add(value);
  if (searched !== undefined && Number.isSafeInteger(searched) && searched <= 2147483647) numbers.add(searched);
  return <Select id={id} showSearch value={value} onChange={onChange} onSearch={setSearch} optionFilterProp="label"
    placeholder="选择未占用序号，可输入数字搜索" options={[...numbers].sort((a, b) => a - b).map(sort => ({
      value: sort, disabled: occupied.has(sort), label: String(sort) + (occupied.has(sort) ? '（已被' + occupied.get(sort)!.name + '占用）' : ''),
    }))} />;
}
