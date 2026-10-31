'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { Err, Page, usePoll } from '@/components/ui';
import OrderTicket from '@/components/OrderTicket';
import type { Order } from '@/lib/types';

export default function MyOrders() {
  const me = useRequireRole('student');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState('');

  const load = () => { if (me) api<{ orders: Order[] }>('/api/orders').then((d) => setOrders(d.orders)).catch((e) => setErr(e.message)); };
  usePoll(load, 8000); // status changes show up on their own

  async function cancel(id: number) {
    setErr('');
    try { await api(`/api/orders/${id}/cancel`, { method: 'POST' }); load(); } catch (e) { setErr((e as Error).message); }
  }
  if (!me) return null;
  const live = (orders ?? []).filter((o) => ['PLACED', 'PREPARING', 'READY'].includes(o.status));
  const past = (orders ?? []).filter((o) => !live.includes(o));

  return (
    <Page title="My orders">
      <Err msg={err} />
      {orders && orders.length === 0 && <p>No orders yet. Your first one is a few taps away.</p>}
      {live.length > 0 && (<><h2>In progress</h2>
        <div className="tickets">{live.map((o) => (
          <OrderTicket key={o.id} order={o} actions={o.status === 'PLACED' ? <button className="btn btn-sm btn-danger" onClick={() => cancel(o.id)}>Cancel order</button> : o.status === 'READY' ? <strong>Ready. Show this token at the counter.</strong> : null} />
        ))}</div></>)}
      {past.length > 0 && (<><h2 style={{ marginTop: '2rem' }}>History</h2>
        <div className="tickets">{past.map((o) => <OrderTicket key={o.id} order={o} />)}</div></>)}
    </Page>
  );
}
