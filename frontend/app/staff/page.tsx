'use client';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { Err, Page, Tabs, usePoll } from '@/components/ui';
import OrderTicket from '@/components/OrderTicket';
import MenuManager from '@/components/MenuManager';
import ForecastPanel from '@/components/ForecastPanel';
import type { Order, OrderStatus } from '@/lib/types';

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PLACED: { to: 'PREPARING', label: 'Start preparing' },
  PREPARING: { to: 'READY', label: 'Mark ready' },
  READY: { to: 'COMPLETED', label: 'Handed over' },
};

export default function StaffDashboard() {
  const me = useRequireRole('staff');
  const [tab, setTab] = useState('Orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState('');

  const load = () => { if (me) api<{ orders: Order[] }>('/api/orders?status=PLACED,PREPARING,READY').then((d) => setOrders(d.orders)).catch((e) => setErr(e.message)); };
  usePoll(load, 6000); // new orders appear without refreshing

  async function move(o: Order, to: OrderStatus) {
    setErr('');
    try { await api(`/api/orders/${o.id}`, { method: 'PATCH', body: { status: to } }); load(); } catch (e) { setErr((e as Error).message); }
  }
  if (!me || !me.stallId) return null;

  const col = (s: OrderStatus, title: string) => (
    <section>
      <h2>{title} ({orders.filter((o) => o.status === s).length})</h2>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {orders.filter((o) => o.status === s).map((o) => (
          <OrderTicket key={o.id} order={o} showStudent actions={NEXT[s] && <button className="btn btn-primary btn-sm" onClick={() => move(o, NEXT[s]!.to)}>{NEXT[s]!.label}</button>} />
        ))}
        {orders.every((o) => o.status !== s) && <p className="muted">Nothing here.</p>}
      </div>
    </section>
  );

  return (
    <Page title="Stall dashboard" sub={`Signed in as ${me.name}`}>
      <Tabs tabs={['Orders', 'Menu', 'Tomorrow’s forecast']} value={tab} onChange={setTab} />
      <Err msg={err} />
      {tab === 'Orders' && <div className="cols">{col('PLACED', 'Incoming')}{col('PREPARING', 'Preparing')}{col('READY', 'Ready for pickup')}</div>}
      {tab === 'Menu' && <MenuManager stallId={me.stallId} />}
      {tab.startsWith('Tomorrow') && <ForecastPanel />}
    </Page>
  );
}
