'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/client/api';
import { CATEGORIES, type Category, type MenuItem } from '@/lib/types';
import { describeItem, rupees } from '@/lib/client/format';
import { Err, VegDot } from './ui';

/** Fields that exist only for one category: the form changes with the category (document model in action). */
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function buildAttributes(cat: Category, f: Record<string, string>) {
  switch (cat) {
    case 'juice': return { size: f.size || 'medium', sugar_level: f.sugar_level || 'regular' };
    case 'sandwich': return { bread_type: f.bread_type || 'white', add_ons: csv(f.add_ons ?? ''), is_spicy: f.is_spicy === 'yes', is_veg: f.is_veg !== 'no' };
    case 'snack': return { is_veg: f.is_veg !== 'no', portion: f.portion || 'regular' };
    case 'combo': return { combo_items: csv(f.combo_items ?? ''), is_veg: f.is_veg !== 'no' };
  }
}

const Sel = ({ label, name, opts, f, set }: { label: string; name: string; opts: string[]; f: Record<string, string>; set: (k: string, v: string) => void }) => (
  <label className="field">{label}
    <select className="input" value={f[name] ?? opts[0]} onChange={(e) => set(name, e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
  </label>
);

export default function MenuManager({ stallId }: { stallId: number }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState<Category>('juice');
  const [name, setName] = useState(''); const [price, setPrice] = useState('50'); const [stock, setStock] = useState('20');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const load = useCallback(() => { api<{ items: MenuItem[] }>(`/api/menu?stallId=${stallId}&all=1`).then((d) => setItems(d.items)).catch((e) => setErr(e.message)); }, [stallId]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setErr(''); setOk('');
    try { await fn(); setOk(msg); load(); } catch (e) { setErr((e as Error).message); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(() => api('/api/menu', { method: 'POST', body: {
      stall_id: stallId, name, category: cat, price: Number(price), stock: Number(stock), is_available: true,
      description: '', tags: [cat], attributes: buildAttributes(cat, f),
    } }), `${name} added to the menu.`);
    setName(''); setAdding(false);
  }

  return (
    <div>
      <div className="row between"><h2>Menu</h2><button className="btn btn-primary" onClick={() => setAdding(!adding)}>{adding ? 'Close form' : 'Add item'}</button></div>
      <Err msg={err} />{ok && <div className="banner ok" role="status">{ok}</div>}

      {adding && (
        <form className="panel" onSubmit={create}>
          <div className="cols">
            <label className="field">Name<input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field">Category
              <select className="input" value={cat} onChange={(e) => { setCat(e.target.value as Category); setF({}); }}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="field">Price (₹)<input className="input" type="number" min="1" step="0.5" required value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label className="field">Stock today<input className="input" type="number" min="0" max="1000" required value={stock} onChange={(e) => setStock(e.target.value)} /></label>
          </div>
          <div className="cols">
            {cat === 'juice' && <><Sel label="Size" name="size" opts={['small', 'medium', 'large']} f={f} set={set} /><Sel label="Sugar level" name="sugar_level" opts={['none', 'low', 'regular', 'high']} f={f} set={set} /></>}
            {cat === 'sandwich' && <>
              <Sel label="Bread" name="bread_type" opts={['white', 'brown', 'multigrain', 'focaccia']} f={f} set={set} />
              <label className="field">Add-ons<input className="input" placeholder="extra cheese, corn" value={f.add_ons ?? ''} onChange={(e) => set('add_ons', e.target.value)} /><span className="hint">Separate with commas</span></label>
              <Sel label="Spicy?" name="is_spicy" opts={['no', 'yes']} f={f} set={set} />
              <Sel label="Veg?" name="is_veg" opts={['yes', 'no']} f={f} set={set} />
            </>}
            {cat === 'snack' && <><Sel label="Portion" name="portion" opts={['small', 'regular', 'large']} f={f} set={set} /><Sel label="Veg?" name="is_veg" opts={['yes', 'no']} f={f} set={set} /></>}
            {cat === 'combo' && <>
              <label className="field">Items in combo<input className="input" required placeholder="Sandwich, Juice" value={f.combo_items ?? ''} onChange={(e) => set('combo_items', e.target.value)} /><span className="hint">At least two, separated by commas</span></label>
              <Sel label="Veg?" name="is_veg" opts={['yes', 'no']} f={f} set={set} />
            </>}
          </div>
          <button className="btn btn-primary">Save item</button>
        </form>
      )}

      <div className="table-scroll"><table>
        <thead><tr><th>Item</th><th>Price</th><th>Stock</th><th>On sale</th><th></th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i._id}>
              <td><VegDot item={i} /><strong>{i.name}</strong><div className="muted">{i.category} · {describeItem(i)}</div></td>
              <td><input className="input" style={{ width: '5.5rem' }} type="number" min="1" step="0.5" defaultValue={i.price} aria-label={`Price of ${i.name}`}
                onBlur={(e) => Number(e.target.value) !== i.price && run(() => api(`/api/menu/${i._id}`, { method: 'PUT', body: { price: Number(e.target.value) } }), 'Price updated.')} /></td>
              <td><input className="input" style={{ width: '5rem' }} type="number" min="0" defaultValue={i.stock} aria-label={`Stock of ${i.name}`}
                onBlur={(e) => Number(e.target.value) !== i.stock && run(() => api(`/api/menu/${i._id}`, { method: 'PUT', body: { stock: Number(e.target.value) } }), 'Stock updated.')} /></td>
              <td><label className="row"><input type="checkbox" checked={i.is_available} onChange={(e) => run(() => api(`/api/menu/${i._id}/availability`, { method: 'PATCH', body: { is_available: e.target.checked } }), e.target.checked ? `${i.name} is on sale.` : `${i.name} switched off.`)} />{i.is_available ? 'Yes' : 'Off'}</label></td>
              <td><button className="btn btn-sm btn-danger" onClick={() => confirm(`Delete ${i.name}?`) && run(() => api(`/api/menu/${i._id}`, { method: 'DELETE' }), `${i.name} deleted.`)}>Delete</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={5} className="muted">No items yet. Add your first dish.</td></tr>}
        </tbody>
      </table></div>
      <p className="muted">Sold out automatically when stock reaches 0. {items.length > 0 && `Total menu value: ${rupees(items.reduce((s, i) => s + i.price, 0))} across ${items.length} items.`}</p>
    </div>
  );
}
