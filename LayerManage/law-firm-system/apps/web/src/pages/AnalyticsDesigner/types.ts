import type { Filter } from '@/features/workspaces/types';
export const chartOptions = [
  ['metric', '指标卡'],
  ['bar', '柱状图'],
  ['line', '折线图'],
  ['horizontal', '条形图'],
  ['area', '面积图'],
  ['pie', '饼图'],
  ['ring', '环形图'],
  ['combo', '组合图'],
  ['radar', '雷达图'],
  ['scatter', '散点图'],
  ['funnel', '漏斗图'],
  ['wordcloud', '词云'],
  ['sankey', '桑基图'],
  ['table', '表格'],
  ['kanban', '看板'],
  ['calendar', '日历'],
  ['gantt', '甘特图'],
  ['gallery', '画册'],
] as const;
export type ChartType = (typeof chartOptions)[number][0];
export interface Widget {
  id: string;
  title: string;
  type: ChartType;
  tableId: string;
  dimension?: string;
  measure?: string;
  secondary?: string;
  dateField?: string;
  endDateField?: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  filter?: Filter;
  join?: { tableId: string; localField: string; foreignField: string; mode: 'left' | 'inner' };
  width: number;
  height: number;
  color: string;
  background: string;
  decimals: number;
  legend: boolean;
}
export interface Board {
  id: string;
  ownerId: string;
  name: string;
  shared: boolean;
  version: number;
  widgets: Widget[];
  refreshSeconds: number;
}
export interface SourceField {
  id: string;
  name: string;
  type: string;
  options: { choices?: { id: string; name: string }[] };
}
export interface Source {
  id: string;
  name: string;
  baseId: string;
  baseName: string;
  fields: SourceField[];
}
export interface DataRow {
  id: string;
  values: Record<string, unknown>;
  labels: Record<string, string>;
}
export interface QueryResult {
  fields: SourceField[];
  records: DataRow[];
  series: { key: string; target: string; value: string; count: number }[];
  metric: string;
  total: number;
  baseId: string;
  tableId: string;
  updatedAt: string;
}
export function newWidget(type: ChartType, tableId = ''): Widget {
  return {
    id: crypto.randomUUID(),
    title: chartOptions.find((c) => c[0] === type)![1],
    type,
    tableId,
    aggregation: 'count',
    width: 6,
    height: 320,
    color: '#1677ff',
    background: '#ffffff',
    decimals: 2,
    legend: true,
  };
}
