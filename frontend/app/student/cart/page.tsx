'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { useCart } from '@/components/CartProvider';
import { Err, Page } from '@/components/ui';
import { rupees, timeOf } from '@/lib/client/format';
import type { OrderItem, Slot } from '@/lib/types';

export default function CartPage() {
  const me = useRequireRole('student');
  const cart = useCart();
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState<number | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [trusted, setTrusted] = useState<{ lines: OrderItem[]; total: number } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  // One id per checkout attempt. If the network drops we RETRY with the same id (server won't double-create).
  const requestId = useRef(crypto.randomUUID());

  const stallId = cart.stallId;
  const cartKey = cart.lines.map((l) => `${l.item._id}:${l.qty}`).join(',');

  useEffect(() => {
    if (!me || !stallId) return;
    api<{ slots: Slot[] }>(`/api/slots?stallId=${stallId}`).then((d) => setSlots(d.slots)).catch((e) => setErr(e.message));
  }, [me, stallId]);

  // Re-check the cart against MongoDB (live stock + the real prices) whenever it changes.
  useEffect(() => {
    if (!me || !stallId || !cart.lines.length) { setTrusted(null); setProblems([]); return; }
    api<{ lines: OrderItem[]; total: number; problems: string[] }>('/api/cart/validate', {
      method: 'POST', body: { stallId, items: cart.lines.map((l) => ({ menuItemId: l.item._id, quantity: l.qty })) },
    }).then((d) => { setTrusted({ lines: d.lines, total: d.total }); setProblems(d.problems); }).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, stallId, cartKey]);

  if (!me) return null;
  if (!cart.lines.length) return (
    <Page title="Your cart is empty"><p>Pick something tasty from <Link href="/student">the stalls</Link>.</p></Page>
  );

  async function place() {
    if (!slotId || !stallId) return;
    setBusy(true); setErr('');
    try {
      await api('/api/orders', { method: 'POST', body: { requestId: requestId.current, stallId, slotId, items: cart.lines.map((l) => ({ menuItemId: l.item._id, quantity: l.qty })) } });
      cart.clear(); requestId.current = crypto.randomUUID();
      router.push('/student/orders');
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof ApiClientError && e.status > 0) { requestId.current = crypto.randomUUID(); setProblems([]); } // definite answer from server -> fresh attempt next time
      // refresh slot availability (someone may have taken the last spot)
      api<{ slots: Slot[] }>(`/api/slots?stallId=${stallId}`).then((d) => setSlots(d.slots)).catch(() => {});
      setBusy(false);
    }
  }

  const total = trusted?.total ?? cart.total;
  return (
    <Page title="Your cart" sub={`Order from ${cart.stallName}`}>
      <div className="panel">
        {cart.lines.map((l) => (
          <div className="row between" key={l.item._id} style={{ padding: '.4rem 0' }}>
            <div className="grow"><strong>{l.item.name}</strong> <span className="muted">{rupees(l.item.price)} each</span></div>
            <div className="row">
              <button className="btn btn-sm" aria-label={`Fewer ${l.item.name}`} onClick={() => cart.setQty(l.item._id, l.qty - 1)}>−</button>
              <span aria-live="polite">{l.qty}</span>
              <button className="btn btn-sm" aria-label={`More ${l.item.name}`} onClick={() => cart.setQty(l.item._id, l.qty + 1)}>+</button>
            </div>
          </div>
        ))}
        <hr />
        <div className="row between"><strong>Total</strong><strong>{rupees(total)}</strong></div>
        <p className="muted">Pay at the counter when you pick up. Prices are confirmed against the live menu when you order.</p>
      </div>
      {problems.map((p) => <div className="banner warn" key={p}>{p}</div>)}

      <h2>Pick a pickup time</h2>
      {slots.length === 0 ? <p className="muted">No more slots today for this stall.</p> : (
        <div className="slots" role="group" aria-label="Pickup slots">
          {slots.map((s) => {
            const left = s.capacity - s.booked;
            return (
              <button key={s.id} className="slot" disabled={left <= 0} aria-pressed={slotId === s.id} onClick={() => setSlotId(s.id)}>
                {timeOf(s.start)}<small>{left <= 0 ? 'full' : `${left} left`}</small>
              </button>
            );
          })}
        </div>
      )}
      <Err msg={err} />
      <div className="row" style={{ marginTop: '1.2rem' }}>
        <button className="btn btn-primary" disabled={!slotId || busy || problems.length > 0} onClick={place}>{busy ? 'Placing order…' : `Place order · ${rupees(total)}`}</button>
        <button className="btn btn-ghost" onClick={cart.clear}>Clear cart</button>
      </div>
    </Page>
  );
}
