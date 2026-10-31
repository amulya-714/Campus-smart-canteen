'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { useCart } from '@/components/CartProvider';
import { Err, LoadMeter, Page, VegDot } from '@/components/ui';
import { describeItem, rupees } from '@/lib/client/format';
import { CATEGORIES, type Category, type MenuItem } from '@/lib/types';

export default function StallMenu() {
  const me = useRequireRole('student');
  const { id } = useParams<{ id: string }>();
  const cart = useCart();
  const [stall, setStall] = useState<{ name: string; description: string; label: 'Quiet' | 'Busy' | 'Very busy'; load: number } | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cat, setCat] = useState<Category | ''>('');
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [pending, setPending] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (!me) return;
    api<{ stall: NonNullable<typeof stall> }>(`/api/stalls/${id}`).then((d) => setStall(d.stall)).catch((e) => setErr(e.message));
    api<{ items: MenuItem[] }>(`/api/menu?stallId=${id}&all=1`).then((d) => setItems(d.items)).catch((e) => setErr(e.message));
  }, [me, id]);
  if (!me) return null;

  const shown = items.filter((i) => !cat || i.category === cat);
  const canOrder = (i: MenuItem) => i.is_available && i.stock > 0;

  function add(i: MenuItem) {
    const r = cart.add(i, stall?.name ?? '');
    if (r === 'other-stall') setPending(i); else setNote(`${i.name} added.`);
  }

  return (
    <Page title={stall?.name ?? 'Menu'} sub={stall ? <>{stall.description} · <LoadMeter load={stall.load} label={stall.label} /></> : ''}>
      <Err msg={err} />
      {pending && (
        <div className="banner warn">
          Your cart has items from {cart.stallName}. One order can only come from one stall.
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button className="btn btn-sm btn-primary" onClick={() => { cart.replaceWith(pending, stall?.name ?? ''); setPending(null); }}>Start a new cart here</button>
            <button className="btn btn-sm" onClick={() => setPending(null)}>Keep my cart</button>
          </div>
        </div>
      )}
      {note && <div className="banner ok" role="status">{note} <Link href="/student/cart">Go to cart ({cart.count})</Link></div>}
      <div className="row" style={{ margin: '.8rem 0' }}>
        <button className={`btn btn-sm ${cat === '' ? 'btn-primary' : ''}`} onClick={() => setCat('')}>All</button>
        {CATEGORIES.filter((c) => items.some((i) => i.category === c)).map((c) => (
          <button key={c} className={`btn btn-sm ${cat === c ? 'btn-primary' : ''}`} onClick={() => setCat(c)}>{c[0].toUpperCase() + c.slice(1)}</button>
        ))}
      </div>
      <div className="items">
        {shown.map((i) => (
          <div className={`item ${canOrder(i) ? '' : 'off'}`} key={i._id}>
            <div><VegDot item={i} /><strong>{i.name}</strong></div>
            <div className="muted">{describeItem(i)}</div>
            <div className="row between">
              <span className="price">{rupees(i.price)}</span>
              {canOrder(i)
                ? <button className="btn btn-sm btn-primary" onClick={() => add(i)}>Add</button>
                : <span className="chip">Sold out</span>}
            </div>
            {canOrder(i) && i.stock <= 5 && <div className="muted">Only {i.stock} left</div>}
          </div>
        ))}
      </div>
    </Page>
  );
}
