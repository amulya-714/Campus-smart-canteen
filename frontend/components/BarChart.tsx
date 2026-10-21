'use client';
/** Tiny dependency-free SVG bar chart. `max` (optional) draws a light "capacity" bar behind each value. */
export interface Bar { label: string; value: number; max?: number }

export default function BarChart({ data, unit = '', height = 170, color = 'var(--ink)' }: { data: Bar[]; unit?: string; height?: number; color?: string }) {
  if (!data.length) return <p className="muted">No data yet.</p>;
  const W = Math.max(320, data.length * 34), pad = 22, H = height;
  const top = Math.max(1, ...data.map((d) => Math.max(d.value, d.max ?? 0)));
  const bw = (W - pad) / data.length;
  const y = (v: number) => H - pad - (v / top) * (H - pad - 8);
  return (
    <div className="table-scroll">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: W > 520 ? W : undefined, maxHeight: H + 20 }} role="img"
        aria-label={`Bar chart: ${data.map((d) => `${d.label} ${d.value}${unit}`).join(', ')}`}>
        <line x1={pad} x2={W} y1={H - pad} y2={H - pad} stroke="var(--ink)" />
        {data.map((d, i) => {
          const x = pad + i * bw + bw * 0.15, w = bw * 0.7;
          return (
            <g key={d.label + i}>
              {d.max !== undefined && <rect x={x} y={y(d.max)} width={w} height={H - pad - y(d.max)} fill="var(--line)" />}
              <rect x={x} y={y(d.value)} width={w} height={H - pad - y(d.value)} fill={color} />
              <text x={x + w / 2} y={H - 7} textAnchor="middle">{d.label}</text>
              {d.value > 0 && <text x={x + w / 2} y={y(d.value) - 3} textAnchor="middle">{Math.round(d.value * 10) / 10}</text>}
              <title>{`${d.label}: ${d.value}${unit}${d.max !== undefined ? ` of ${d.max}` : ''}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
