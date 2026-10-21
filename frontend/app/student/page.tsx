'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { Err, LoadMeter, Page, usePoll, VegDot } from '@/components/ui';
import { describeItem, rupees } from '@/lib/client/format';
import { useCart } from '@/components/CartProvider';
import type { MenuItem } from '@/lib/types';

interface RankedStall {
  id: number; name: string; location: string; description: string; score: number; label: 'Quiet' | 'Busy' | 'Very busy';
  load: number; availableItems: number; totalItems: number; slotsFreeNextHour: number;
}

export default function StudentHome() {
  const me = useRequireRole('student');
  const cart = useCart();
  const [stalls, setStalls] = useState<RankedStall[]>([]);
  const [results, setResults] = useState<(MenuItem & { rank_score: number })[] | null>(null);
  const [q, setQ] = useState(''); const [veg, setVeg] = useState(false);
  const [err, setErr] = useState(''); const [note, setNote] = useState('');

  const load = useCallback(() => { api<{ stalls: RankedStall[] }>('/api/stalls').then((d) => setStalls(d.stalls)).catch((e) => setErr(e.message)); }, []);
  usePoll(load, 20000);

  useEffect(() => {
    if (!q.trim() && !veg) { setResults(null); return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (veg) p.set('veg', '1');
      api<{ items: (MenuItem & { rank_score: number })[] }>(`/api/menu?${p}`).then((d) => setResults(d.items)).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, veg]);

  if (!me) return null;
  const nameOf = (id: number) => stalls.find((s) => s.id === id)?.name ?? `Stall ${id}`;

  return (
    <Page title="What are you eating?" sub="Stalls are sorted so the ones with food in stock and a short queue come first.">
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input className="input grow" type="search" placeholder="Search dishes, e.g. paneer, juice, combo" aria-label="Search menu" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row"><input type="checkbox" checked={veg} onChange={(e) => setVeg(e.target.checked)} /> Veg only</label>
      </div>
      <Err msg={err} />
      {note && <div className="banner warn">{note}</div>}

      {results ? (
        <>
          <h2>{results.length} dish{results.length === 1 ? '' : 'es'} found</h2>
          {results.length === 0 && <p className="muted">Nothing matches. Try a shorter word.</p>}
          <div className="items">
            {results.map((i) => (
              <div className="item" key={i._id}>
                <div><VegDot item={i} /><strong>{i.name}</strong></div>
                <div className="muted">{describeItem(i)}</div>
                <div className="muted">at <Link href={`/student/stall/${i.stall_id}`}>{nameOf(i.stall_id)}</Link></div>
                <div className="row between"><span className="price">{rupees(i.price)}</span>
                  <button className="btn btn-sm btn-primary" onClick={() => setNote(cart.add(i, nameOf(i.stall_id)) === 'ok' ? `${i.name} added to cart.` : 'Your cart has items from another stall. Open that stall or clear the cart first.')}>Add</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <section aria-label="Stalls">
          {stalls.length === 0 && !err && <p className="muted">Loading stalls…</p>}
          {stalls.map((s, idx) => (
            <div className="stall-row" key={s.id}>
              <div>
                <h3><Link href={`/student/stall/${s.id}`}>{s.name}</Link> {idx === 0 && s.label === 'Quiet' && <span className="chip">Best pick now</span>}</h3>
                <div className="muted">{s.description} · {s.location}</div>
              </div>
              <div className="stall-side">
                <LoadMeter load={s.load} label={s.label} />
                <div className="muted">{s.availableItems}/{s.totalItems} dishes available · {s.slotsFreeNextHour}% of slots free</div>
              </div>
            </div>
          ))}
        </section>
      )}
    </Page>
  );
}
