'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import type { MenuItem } from '@/lib/types';
import { isVeg } from '@/lib/client/format';

export const Err = ({ msg }: { msg: string }) => (msg ? <div className="banner err" role="alert">{msg}</div> : null);

export const VegDot = ({ item }: { item: MenuItem }) => (
  <span className={`veg ${isVeg(item) ? '' : 'non'}`} role="img" aria-label={isVeg(item) ? 'Vegetarian' : 'Non-vegetarian'} />
);

export function LoadMeter({ load, label }: { load: number; label: 'Quiet' | 'Busy' | 'Very busy' }) {
  const lit = Math.max(load > 0 ? 1 : 0, Math.round(load * 5));
  const cls = label === 'Quiet' ? 'quiet' : label === 'Busy' ? 'busy' : 'vbusy';
  return (
    <span title={`Queue: ${label}`}>
      <span className={`meter ${cls}`} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < lit ? 'on' : ''} />)}</span>{' '}
      <strong>{label}</strong>
    </span>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t} role="tab" className="tab" aria-selected={value === t} onClick={() => onChange(t)}>{t}</button>)}
    </div>
  );
}

/** Calls `fn` now and then every `ms` milliseconds (live order boards). */
export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => { ref.current(); const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

export function Page({ title, children, sub }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (<main className="wrap"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}{children}</main>);
}
