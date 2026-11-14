import { useState } from 'react';
import { Button, Empty, Table } from 'antd';
import { Link } from 'react-router';
import AttachmentItem from '@/features/workspaces/AttachmentItem';
import type { DataRow, QueryResult, Widget } from './types';

function rowLink(data: QueryResult, row: DataRow) {
  return `/workspaces?base=${encodeURIComponent(data.baseId)}&table=${encodeURIComponent(data.tableId)}&record=${encodeURIComponent(row.id)}`;
}
export function RecordTable({ data, rows = data.records }: { data: QueryResult; rows?: DataRow[] }) {
  return (
    <Table
      size="small"
      rowKey={(r) => r.id + JSON.stringify(r.values)}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 10, showSizeChanger: true }}
      columns={[
        ...data.fields.map((f) => ({
          title: f.name,
          key: f.id,
          width: 140,
          render: (_: unknown, r: DataRow) => r.labels[f.id],
        })),
        {
          title: '操作',
          key: 'action',
          fixed: 'right',
          render: (_: unknown, r: DataRow) => <Link to={rowLink(data, r)}>打开记录</Link>,
        },
      ]}
    />
  );
}
export default function WidgetView({
  widget: w,
  data,
  onSelect,
}: {
  widget: Widget;
  data: QueryResult;
  onSelect: (key?: string, target?: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const number = (v: string | number) =>
    Number(v).toLocaleString('zh-CN', { maximumFractionDigits: w.decimals });
  if (w.type === 'metric')
    return (
      <button className="analytics-metric" onClick={() => onSelect()} style={{ color: w.color }}>
        <strong>{number(data.metric)}</strong>
        <span>{data.total} 条明细 · 点击查看</span>
      </button>
    );
  if (!data.total) return <Empty description="没有符合筛选条件的可见记录" />;
  if (w.type === 'table') return <RecordTable data={data} />;
  const label = (r: DataRow, id?: string) => (id ? r.labels[id] || '未填写' : r.id);
  if (w.type === 'kanban')
    return (
      <div className="analytics-kanban">
        {[...new Set(data.records.map((r) => label(r, w.dimension)))].map((key) => (
          <section key={key}>
            <h4>{key}</h4>
            {data.records
              .filter((r) => label(r, w.dimension) === key)
              .map((r, i) => (
                <Link className="analytics-record-card" key={r.id + i} to={rowLink(data, r)}>
                  {label(r, w.secondary || data.fields[0]?.id)}
                </Link>
              ))}
          </section>
        ))}
      </div>
    );
  if (w.type === 'gallery')
    return (
      <div className="analytics-gallery">
        {data.records.map((r, i) => (
          <article key={r.id + i} className="analytics-record-card">
            <h4>
              <Link to={rowLink(data, r)}>{label(r, w.dimension || data.fields[0]?.id)}</Link>
            </h4>
            {data.fields
              .filter((f) => f.type === 'FILE' && !f.id.startsWith('related:'))
              .slice(0, 1)
              .map((f) => (
                <div key={f.id}>
                  {Array.isArray(r.values[f.id])
                    ? (r.values[f.id] as string[])
                        .slice(0, 3)
                        .map((id) => <AttachmentItem key={id} id={id} tableId={data.tableId} />)
                    : null}
                </div>
              ))}
            {data.fields
              .filter((f) => f.type !== 'FILE')
              .slice(0, 5)
              .map((f) => (
                <p key={f.id}>
                  {f.name}：{label(r, f.id)}
                </p>
              ))}
          </article>
        ))}
      </div>
    );
  const date = (r: DataRow, id?: string) =>
    id && r.values[id] ? new Date(String(r.values[id])).getTime() : NaN;
  if (w.type === 'calendar') {
    const start = new Date(month + '-01T00:00:00');
    const first = new Date(start);
    first.setDate(1 - ((start.getDay() + 6) % 7));
    return (
      <>
        <label>
          显示月份{' '}
          <input
            aria-label="显示月份"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
        <div className="analytics-calendar">
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <b key={d}>{d}</b>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const d = new Date(first);
            d.setDate(first.getDate() + i);
            return (
              <section key={i}>
                <span>
                  {d.getMonth() + 1}/{d.getDate()}
                </span>
                {data.records
                  .filter((r) => {
                    const t = date(r, w.dateField);
                    return Number.isFinite(t) && new Date(t).toDateString() === d.toDateString();
                  })
                  .map((r, j) => (
                    <Link key={r.id + j} to={rowLink(data, r)}>
                      {label(r, w.dimension || data.fields[0]?.id)}
                    </Link>
                  ))}
              </section>
            );
          })}
        </div>
      </>
    );
  }
  if (w.type === 'gantt') {
    const rows = data.records.filter(
      (r) =>
        Number.isFinite(date(r, w.dateField)) &&
        Number.isFinite(date(r, w.endDateField)) &&
        date(r, w.endDateField) >= date(r, w.dateField),
    );
    if (!rows.length) return <Empty description="暂无有效的开始、结束日期" />;
    const min = Math.min(...rows.map((r) => date(r, w.dateField))),
      max = Math.max(...rows.map((r) => date(r, w.endDateField))),
      range = Math.max(max - min, 86400000);
    return (
      <div className="analytics-gantt">
        <p>
          {new Date(min).toLocaleDateString()} — {new Date(max).toLocaleDateString()}
        </p>
        {rows.map((r, i) => (
          <div key={r.id + i}>
            <Link to={rowLink(data, r)}>{label(r, w.dimension || data.fields[0]?.id)}</Link>
            <span>
              <a
                href={rowLink(data, r)}
                title={`${label(r, w.dateField)} — ${label(r, w.endDateField)}`}
                style={{
                  background: w.color,
                  left: `${((date(r, w.dateField) - min) / range) * 95}%`,
                  width: `${Math.max(1, ((date(r, w.endDateField) - date(r, w.dateField)) / range) * 95)}%`,
                }}
              />
            </span>
          </div>
        ))}
      </div>
    );
  }
  const series = data.series;
  const points = series.map((s, i) => ({ ...s, n: Number(s.value), i }));
  const max = Math.max(1, ...points.map((s) => Math.abs(s.n)));
  const colors = points.map((_, i) => (i === 0 ? w.color : `hsl(${(i * 47 + 205) % 360} 65% 52%)`));
  const click = (i: number) => onSelect(points[i].key, points[i].target);
  const accessible = (i: number) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `${points[i].key} ${number(points[i].n)}，查看明细`,
    onClick: () => click(i),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        click(i);
      }
    },
  });
  if (w.type === 'wordcloud')
    return (
      <div className="analytics-cloud">
        {points.map((s) => (
          <button
            key={s.i}
            onClick={() => click(s.i)}
            style={{ color: colors[s.i], fontSize: 14 + (Math.abs(s.n) / max) * 34 }}
          >
            {s.key} <small>{number(s.n)}</small>
          </button>
        ))}
      </div>
    );
  if (['pie', 'ring', 'funnel', 'sankey', 'radar'].includes(w.type) && points.some((s) => s.n < 0))
    return <Empty description="此图表不支持负数，请更换图表或筛选数据" />;
  let chart: React.ReactNode;
  if (w.type === 'pie' || w.type === 'ring') {
    const total = points.reduce((a, b) => a + b.n, 0);
    let angle = -Math.PI / 2;
    chart =
      total === 0 ? (
        <text x="300" y="125" textAnchor="middle">
          合计为 0
        </text>
      ) : (
        points.map((s) => {
          const from = angle,
            span = (s.n / total) * Math.PI * 2;
          angle += span;
          const r = 95,
            x = 300,
            y = 120;
          const d = `M ${x} ${y} L ${x + r * Math.cos(from)} ${y + r * Math.sin(from)} A ${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${x + r * Math.cos(angle)} ${y + r * Math.sin(angle)} Z`;
          return span >= Math.PI * 2 - 0.00001 ? (
            <circle key={s.i} cx={x} cy={y} r={r} fill={colors[s.i]} {...accessible(s.i)} />
          ) : (
            <path key={s.i} d={d} fill={colors[s.i]} {...accessible(s.i)} />
          );
        })
      );
    if (w.type === 'ring')
      chart = (
        <>
          {chart}
          <circle cx="300" cy="120" r="52" fill={w.background} />
          <text x="300" y="125" textAnchor="middle">
            {number(data.metric)}
          </text>
        </>
      );
  } else if (w.type === 'radar') {
    const size = Math.max(points.length, 3);
    const at = (i: number, r: number) => [
      300 + Math.sin((i / size) * Math.PI * 2) * r,
      125 - Math.cos((i / size) * Math.PI * 2) * r,
    ];
    chart = (
      <>
        {[25, 50, 75, 100].map((r) => (
          <polygon
            key={r}
            points={Array.from({ length: size }, (_, i) => at(i, r).join(',')).join(' ')}
            fill="none"
            stroke="#d9d9d9"
          />
        ))}
        <polygon
          points={points.map((s) => at(s.i, (s.n / max) * 100).join(',')).join(' ')}
          fill={w.color}
          fillOpacity=".25"
          stroke={w.color}
        />
        {points.map((s) => {
          const [x, y] = at(s.i, (s.n / max) * 100);
          const [tx, ty] = at(s.i, 112);
          return (
            <g key={s.i}>
              <circle cx={x} cy={y} r="6" fill={w.color} {...accessible(s.i)} />
              <text x={tx} y={ty} textAnchor="middle" fontSize="11">
                {s.key.slice(0, 10)}
              </text>
            </g>
          );
        })}
      </>
    );
  } else if (w.type === 'funnel') {
    chart = points.map((s, i) => {
      const h = 220 / points.length,
        wide = (s.n / max) * 480,
        next = ((points[i + 1]?.n || 0) / max) * 480;
      return (
        <g key={i} {...accessible(i)}>
          <polygon
            points={`${300 - wide / 2},${i * h} ${300 + wide / 2},${i * h} ${300 + next / 2},${(i + 1) * h} ${300 - next / 2},${(i + 1) * h}`}
            fill={colors[i]}
          />
          <text x="300" y={(i + 0.5) * h} textAnchor="middle" fill="#111">
            {s.key} {number(s.n)}
          </text>
        </g>
      );
    });
  } else if (w.type === 'sankey') {
    const left = [...new Set(points.map((p) => p.key))],
      right = [...new Set(points.map((p) => p.target))];
    const sum = points.reduce((a, b) => a + b.n, 0) || 1;
    const ly = new Map<string, number>(),
      ry = new Map<string, number>();
    let a = 5,
      b = 5;
    for (const key of left) {
      ly.set(key, a);
      a += (points.filter((p) => p.key === key).reduce((n, p) => n + p.n, 0) / sum) * 180 + 5;
    }
    for (const key of right) {
      ry.set(key, b);
      b += (points.filter((p) => p.target === key).reduce((n, p) => n + p.n, 0) / sum) * 180 + 5;
    }
    chart = (
      <>
        {points.map((p) => {
          const h = (p.n / sum) * 180,
            y1 = ly.get(p.key)!,
            y2 = ry.get(p.target)!;
          ly.set(p.key, y1 + h);
          ry.set(p.target, y2 + h);
          return (
            <path
              key={p.i}
              d={`M 120 ${y1} C 250 ${y1},350 ${y2},480 ${y2} L 480 ${y2 + h} C 350 ${y2 + h},250 ${y1 + h},120 ${y1 + h} Z`}
              fill={colors[p.i]}
              fillOpacity=".65"
              {...accessible(p.i)}
            />
          );
        })}
        {left.map((key) => (
          <text key={key} x="5" y={ly.get(key)} fontSize="12">
            {key.slice(0, 12)}
          </text>
        ))}
        {right.map((key) => (
          <text key={key} x="485" y={ry.get(key)} fontSize="12">
            {key.slice(0, 12)}
          </text>
        ))}
      </>
    );
  } else if (w.type === 'horizontal') {
    chart = points.map((s) => (
      <g key={s.i} {...accessible(s.i)}>
        <text x="5" y={(s.i * 240) / points.length + 15} fontSize="12">
          {s.key.slice(0, 10)}
        </text>
        <rect
          x={s.n < 0 ? 350 - (Math.abs(s.n) / max) * 220 : 350}
          y={(s.i * 240) / points.length}
          width={(Math.abs(s.n) / max) * 220}
          height={Math.max(3, 220 / points.length - 3)}
          fill={w.color}
        />
        <text x="120" y={(s.i * 240) / points.length + 15} fontSize="12">
          {number(s.n)}
        </text>
      </g>
    ));
  } else {
    const hasNegative = points.some((p) => p.n < 0),
      zero = hasNegative ? 120 : 220,
      scale = hasNegative ? 95 : 190;
    const numericX = points.map((p) => Number(p.key));
    if (w.type === 'scatter' && numericX.some((v) => !Number.isFinite(v)))
      return <Empty description="散点图的维度应为数值字段" />;
    const minX = Math.min(...numericX),
      rangeX = Math.max(1, Math.max(...numericX) - minX);
    const x = (i: number) =>
        w.type === 'scatter'
          ? 50 + ((numericX[i] - minX) / rangeX) * 520
          : 50 + ((i + 0.5) * 520) / Math.max(points.length, 1),
      y = (v: number) => zero - (v / max) * scale;
    const line = points.map((p) => `${x(p.i)},${y(p.n)}`).join(' ');
    chart = (
      <>
        <line x1="40" y1={zero} x2="590" y2={zero} stroke="#aaa" />
        {w.type === 'area' && (
          <polygon
            points={`${x(0)},${zero} ${line} ${x(points.length - 1)},${zero}`}
            fill={w.color}
            fillOpacity=".22"
          />
        )}
        {['line', 'area', 'combo'].includes(w.type) && (
          <polyline points={line} fill="none" stroke={w.color} strokeWidth="3" />
        )}
        {points.map((p) => (
          <g key={p.i}>
            <title>
              {p.key}: {number(p.n)}
            </title>
            {['bar', 'combo'].includes(w.type) ? (
              <rect
                x={x(p.i) - Math.min(25, 200 / points.length)}
                y={Math.min(zero, y(p.n))}
                width={Math.min(50, 400 / points.length)}
                height={Math.max(1, (Math.abs(p.n) / max) * scale)}
                fill={w.color}
                fillOpacity={w.type === 'combo' ? 0.35 : 1}
                {...accessible(p.i)}
              />
            ) : (
              <circle cx={x(p.i)} cy={y(p.n)} r="6" fill={w.color} {...accessible(p.i)} />
            )}
            <text x={x(p.i)} y="245" textAnchor="middle" fontSize="10">
              {p.key.slice(0, 8)}
            </text>
          </g>
        ))}
      </>
    );
  }
  return (
    <>
      <svg role="img" aria-label={w.title} viewBox="0 0 600 260" style={{ width: '100%', minHeight: 180 }}>
        {chart}
      </svg>
      {w.legend && (
        <div className="analytics-legend">
          {points.map((s) => (
            <Button type="text" size="small" key={s.i} onClick={() => click(s.i)}>
              <i style={{ background: colors[s.i] }} />
              {s.key}
              {s.target ? ' → ' + s.target : ''}：{number(s.n)}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
