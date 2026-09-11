import { Table as AntTable, type TableProps } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react';
import './resizable-table.css';

const MIN = 72, MAX = 1200;
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, Math.round(value)));
type Widths = Record<string, number>;
function readWidths(key: string): Widths {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, width]) => typeof width === 'number' && Number.isFinite(width) && width >= MIN && width <= MAX));
  } catch { return {}; }
}
function columnKey<T>(column: ColumnType<T>, path: string) { return String(column.key ?? (Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex) ?? path); }
function schemaKey<T>(columns: ColumnsType<T>, prefix = ''): string {
  return columns.map((column, index) => 'children' in column ? schemaKey(column.children, `${prefix}${index}.`) : columnKey(column, `${prefix}${index}`)).join('|');
}

/** Shared business table: compatible with AntD columns, selection, fixed columns and pagination. */
export default function ResizableTable<T extends object>(props: TableProps<T> & { columnWidthsKey?: string }) {
  const { columnWidthsKey, ...tableProps } = props;
  const key = `chengye:table-widths:v1:${columnWidthsKey || `${window.location.pathname}:${schemaKey(props.columns || [])}`}`;
  return <TableWithWidths<T> key={key} {...tableProps} storageKey={key} />;
}

function TableWithWidths<T extends object>({ storageKey, columns = [], scroll, className, ...props }: TableProps<T> & { storageKey: string; columnWidthsKey?: string }) {
  const [widths, setWidths] = useState<Widths>(() => readWidths(storageKey));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ key: string; startX: number; width: number; widths: Widths } | null>(null);
  const current = useRef(widths);
  const set = (next: Widths, persist: boolean) => {
    current.current = next; setWidths(next);
    if (persist) { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Private/disabled storage does not disable resizing. */ } }
  };
  const reset = (key: string) => { const next = { ...current.current }; delete next[key]; set(next, true); };
  const finish = () => { if (drag.current) { set(current.current, true); drag.current = null; setDragging(false); } };
  const start = (event: PointerEvent<HTMLSpanElement>, key: string, width: number) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const measured = event.currentTarget.closest('th')?.getBoundingClientRect().width;
    drag.current = { key, startX: event.clientX, width: measured || width, widths: current.current };
    event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(true);
  };
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    event.preventDefault(); event.stopPropagation();
    const { key, startX, width, widths: initial } = drag.current;
    set({ ...initial, [key]: clamp(width + event.clientX - startX) }, false);
  };
  const keyboard = (event: KeyboardEvent<HTMLSpanElement>, key: string, width: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') reset(key);
    else set({ ...current.current, [key]: clamp(width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 10)) }, true);
  };

  const decorate = (items: ColumnsType<T>, prefix = ''): ColumnsType<T> => items.map((column, index) => {
    if ('children' in column) return { ...column, children: decorate(column.children, `${prefix}${index}.`) };
    if (column.hidden) return column;
    const key = columnKey(column, `${prefix}${index}`);
    const width = (Object.hasOwn(widths, key) ? widths[key] : undefined) ?? clamp(typeof column.width === 'number' ? column.width : 180);
    const label = typeof column.title === 'string' ? column.title : `第 ${index + 1}`;
    const title = (content: ReactNode) => <span className="resizable-column-title">{content}<span
      role="separator" aria-orientation="vertical" aria-label={`${label}列宽`} aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width}
      tabIndex={0} className="column-resize-handle" title="拖动调整列宽；双击恢复默认。左右键调整，Home 恢复。"
      onPointerDown={event => start(event, key, width)} onPointerMove={move}
      onPointerUp={event => { event.stopPropagation(); finish(); }} onPointerCancel={finish} onLostPointerCapture={finish}
      onClick={event => event.stopPropagation()} onDoubleClick={event => { event.stopPropagation(); reset(key); }}
      onKeyDown={event => keyboard(event, key, width)}
    /></span>;
    const originalTitle = column.title;
    return { ...column, width, title: typeof originalTitle === 'function' ? state => title(originalTitle(state)) : title(originalTitle),
      onHeaderCell: item => { const existing = column.onHeaderCell?.(item) || {}; return { ...existing, style: { ...existing.style, position: column.fixed ? 'sticky' : 'relative' } }; },
    };
  });
  // The decorator only attaches event handlers; refs are read when those events fire.
  // eslint-disable-next-line react-hooks/refs
  const adjustedColumns = decorate(columns);
  const sumWidths = (items: ColumnsType<T>): number => items.reduce((sum, column) => sum + (column.hidden ? 0 : 'children' in column ? sumWidths(column.children) : Number(column.width) || 0), 0);
  const total = sumWidths(adjustedColumns) + (props.rowSelection ? 48 : 0) + (props.expandable ? 48 : 0);
  return <AntTable<T> {...props} className={`resizable-table${dragging ? ' table-resizing' : ''}${className ? ` ${className}` : ''}`}
    columns={adjustedColumns} tableLayout="fixed" scroll={{ ...scroll, x: total || scroll?.x }} />;
}
