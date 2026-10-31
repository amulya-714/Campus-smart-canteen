'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { hourLabel } from '@/lib/client/format';
import type { Forecast } from '@/lib/types';
import BarChart from './BarChart';

export default function ForecastPanel({ stallNames }: { stallNames?: Record<number, string> }) {
  const [f, setF] = useState<Forecast | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Forecast>('/api/forecast').then(setF).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="banner err">{err}</div>;
  if (!f) return <p className="muted">Loading forecast…</p>;
  if (!f.available) return <div className="banner warn">{f.note ?? 'Forecast not available.'}</div>;
  return (
    <div>
      <p className="muted">
        Predicted orders for <strong>{f.target_date}</strong> (model: {f.model}). {f.data_source === 'synthetic' ? <>Based on <strong>synthetic (invented) data</strong> until real orders exist.</> : 'Based on real order history.'}
      </p>
      <div className="cols">
        {f.stalls.map((s) => (
          <div className="panel" key={s.stall_id}>
            <h3>{stallNames?.[s.stall_id] ?? `Stall ${s.stall_id}`}</h3>
            <p><strong>{Math.round(s.total_orders)}</strong> orders expected · peak at <strong>{hourLabel(s.peak_hour)}</strong></p>
            <BarChart data={s.hourly.map((h) => ({ label: hourLabel(h.hour), value: h.predicted_orders }))} unit=" orders" height={150} color="var(--sky)" />
          </div>
        ))}
      </div>
    </div>
  );
}
