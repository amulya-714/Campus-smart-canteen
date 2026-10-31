'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';
import { useRequireRole } from '@/components/AuthProvider';
import { Err, Page, Tabs } from '@/components/ui';
import BarChart from '@/components/BarChart';
import ForecastPanel from '@/components/ForecastPanel';
import { hourLabel, rupees, timeOf } from '@/lib/client/format';
import type { Forecast, Order, Stall, User } from '@/lib/types';

interface Demand {
  utilizationByHour: { hour: number; capacity: number; booked: number }[];
  utilizationByStall: { stallId: number; capacity: number; booked: number }[];
  dailyOrders: { date: string; stallId: number; orders: number }[];
  forecast: Forecast;
}
type StaffRow = User & { stallName: string | null };

export default function AdminDashboard() {
  const me = useRequireRole('admin');
  const [tab, setTab] = useState('Overview');
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [demand, setDemand] = useState<Demand | null>(null);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const loadAll = useCallback(() => {
    api<Demand>('/api/admin/demand').then(setDemand).catch((e) => setErr(e.message));
    api<{ stalls: Stall[] }>('/api/admin/stalls').then((d) => setStalls(d.stalls)).catch((e) => setErr(e.message));
    api<{ staff: StaffRow[] }>('/api/admin/staff').then((d) => setStaff(d.staff)).catch((e) => setErr(e.message));
    api<{ orders: Order[] }>('/api/orders').then((d) => setOrders(d.orders)).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { if (me) loadAll(); }, [me, loadAll]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setErr(''); setOk('');
    try { await fn(); setOk(msg); loadAll(); } catch (e) { setErr((e as Error).message); }
  }

  // forms
  const [sName, setSName] = useState(''); const [sLoc, setSLoc] = useState('');
  const [tName, setTName] = useState(''); const [tEmail, setTEmail] = useState(''); const [tPass, setTPass] = useState(''); const [tStall, setTStall] = useState('');
  const addStall = (e: FormEvent) => { e.preventDefault(); run(() => api('/api/admin/stalls', { method: 'POST', body: { name: sName, location: sLoc } }), `${sName} added.`).then(() => { setSName(''); setSLoc(''); }); };
  const addStaff = (e: FormEvent) => { e.preventDefault(); run(() => api('/api/admin/staff', { method: 'POST', body: { name: tName, email: tEmail, password: tPass, stallId: Number(tStall) } }), `${tName} can now log in.`).then(() => { setTName(''); setTEmail(''); setTPass(''); }); };

  if (!me) return null;
  const nameOf = (id: number) => stalls.find((s) => s.id === id)?.name ?? `Stall ${id}`;
  const totalCap = demand?.utilizationByHour.reduce((n, h) => n + h.capacity, 0) ?? 0;
  const totalBooked = demand?.utilizationByHour.reduce((n, h) => n + h.booked, 0) ?? 0;
  const perDay = new Map<string, number>();
  demand?.dailyOrders.forEach((d) => perDay.set(d.date, (perDay.get(d.date) ?? 0) + d.orders));
  const stallNames = Object.fromEntries(stalls.map((s) => [s.id, s.name]));

  return (
    <Page title="Admin">
      <Tabs tabs={['Overview', 'Forecast', 'Stalls', 'Staff', 'All orders']} value={tab} onChange={setTab} />
      <Err msg={err} />{ok && <div className="banner ok" role="status">{ok}</div>}

      {tab === 'Overview' && demand && (<>
        <div className="stats">
          <div className="stat"><b>{stalls.filter((s) => s.isActive).length}</b>active stalls</div>
          <div className="stat"><b>{totalBooked}/{totalCap}</b>slots booked today</div>
          <div className="stat"><b>{totalCap ? Math.round((100 * totalBooked) / totalCap) : 0}%</b>slot utilization</div>
          <div className="stat"><b>{orders.filter((o) => ['PLACED', 'PREPARING'].includes(o.status)).length}</b>orders in the kitchen</div>
        </div>
        <div className="panel"><h3>Slot utilization by hour today</h3><p className="muted">Dark = booked, light = total capacity.</p>
          <BarChart data={demand.utilizationByHour.map((h) => ({ label: hourLabel(h.hour), value: h.booked, max: h.capacity }))} /></div>
        <div className="cols">
          <div className="panel"><h3>Utilization by stall today</h3>
            <BarChart data={demand.utilizationByStall.map((s) => ({ label: nameOf(s.stallId).split(' ')[0], value: s.booked, max: s.capacity }))} /></div>
          <div className="panel"><h3>Orders per day (last 14 days)</h3>
            <BarChart color="var(--leaf)" data={[...perDay].map(([d, n]) => ({ label: d.slice(5), value: n }))} /></div>
        </div>
      </>)}

      {tab === 'Forecast' && <ForecastPanel stallNames={stallNames} />}

      {tab === 'Stalls' && (<>
        <form className="panel row" onSubmit={addStall}>
          <label className="field grow">New stall name<input className="input" required minLength={2} value={sName} onChange={(e) => setSName(e.target.value)} /></label>
          <label className="field grow">Location<input className="input" value={sLoc} onChange={(e) => setSLoc(e.target.value)} /></label>
          <button className="btn btn-primary">Add stall</button>
        </form>
        <div className="table-scroll"><table><thead><tr><th>Stall</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>
          {stalls.map((s) => (
            <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.location}</td><td>{s.isActive ? 'Open for orders' : 'Removed'}</td>
              <td>{s.isActive && <button className="btn btn-sm btn-danger" onClick={() => confirm(`Remove ${s.name}? Past orders are kept.`) && run(() => api(`/api/admin/stalls/${s.id}`, { method: 'DELETE' }), `${s.name} removed.`)}>Remove</button>}</td></tr>
          ))}</tbody></table></div>
      </>)}

      {tab === 'Staff' && (<>
        <form className="panel" onSubmit={addStaff}>
          <div className="cols">
            <label className="field">Name<input className="input" required value={tName} onChange={(e) => setTName(e.target.value)} /></label>
            <label className="field">Email<input className="input" type="email" required value={tEmail} onChange={(e) => setTEmail(e.target.value)} /></label>
            <label className="field">Temporary password<input className="input" type="password" required minLength={8} value={tPass} onChange={(e) => setTPass(e.target.value)} /></label>
            <label className="field">Stall<select className="input" required value={tStall} onChange={(e) => setTStall(e.target.value)}>
              <option value="">Choose a stall</option>{stalls.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </div>
          <button className="btn btn-primary">Create staff account</button>
        </form>
        <div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Stall</th><th></th></tr></thead><tbody>
          {staff.map((s) => (
            <tr key={s.id}><td>{s.name}</td><td>{s.email}</td><td>{s.stallName}</td>
              <td><button className="btn btn-sm btn-danger" onClick={() => confirm(`Delete ${s.name}'s account?`) && run(() => api(`/api/admin/staff/${s.id}`, { method: 'DELETE' }), 'Account deleted.')}>Delete</button></td></tr>
          ))}</tbody></table></div>
      </>)}

      {tab === 'All orders' && (
        <div className="table-scroll"><table><thead><tr><th>Token</th><th>Stall</th><th>Student</th><th>Items</th><th>Pickup</th><th>Status</th><th>Total</th></tr></thead><tbody>
          {orders.map((o) => (
            <tr key={o.id}><td>#{o.id}</td><td>{o.stallName}</td><td>{o.studentName}</td><td>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td>
              <td>{timeOf(o.slotStart)}</td><td><span className={`chip ${o.status}`}>{o.status}</span></td><td>{rupees(o.totalAmount)}</td></tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={7} className="muted">No orders yet.</td></tr>}</tbody></table></div>
      )}
    </Page>
  );
}
