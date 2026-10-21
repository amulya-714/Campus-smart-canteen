/**
 * Cross-database consistency tests. We use in-memory FAKES for MongoDB (stock) and
 * PostgreSQL (orders/slots), so these run anywhere and we can inject failures on demand.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cancelOrder, checkCart, placeOrder, reconcile, type SagaDeps } from '@/lib/services/orderSaga';
import { SlotFullError } from '@/lib/postgres/types';
import type { Saga, SagaStatus } from '@/lib/mongo/sagaRepo';
import type { MenuItem, Order } from '@/lib/types';

const ID_A = 'a'.repeat(24), ID_B = 'b'.repeat(24), ID_OTHER = 'c'.repeat(24);

function world(opts: { slotCapacity?: number } = {}) {
  const stock = new Map<string, { stall_id: number; name: string; price: number; stock: number; on: boolean }>([
    [ID_A, { stall_id: 1, name: 'Orange Juice', price: 40, stock: 3, on: true }],
    [ID_B, { stall_id: 1, name: 'Mosambi', price: 30, stock: 1, on: true }],
    [ID_OTHER, { stall_id: 2, name: 'Sandwich', price: 60, stock: 9, on: true }],
  ]);
  const orders: Order[] = [];
  const sagas = new Map<string, Saga>();
  const slot = { capacity: opts.slotCapacity ?? 15, booked: 0 };
  const fail = { createOrder: null as null | Error, releaseStock: false, orderLookupThrows: false, createButLoseReply: false };

  const deps: SagaDeps = {
    db: {
      getStall: async (id) => (id === 1 || id === 2 ? { id, name: 'S', location: '', description: '', isActive: true } : null),
      getOrderByRequestId: async (rid) => {
        if (fail.orderLookupThrows) throw new Error('pg down');
        return orders.find((o) => o.requestId === rid) ?? null;
      },
      createOrder: async (i) => {
        if (fail.createOrder) throw fail.createOrder;
        if (slot.booked >= slot.capacity) throw new SlotFullError();
        slot.booked++;
        const o: Order = { id: orders.length + 1, requestId: i.requestId, studentId: i.studentId, stallId: i.stallId, slotId: i.slotId, status: 'PLACED', totalAmount: i.totalAmount, createdAt: new Date().toISOString(), items: i.items };
        orders.push(o);
        if (fail.createButLoseReply) throw new Error('timeout after commit');
        return o;
      },
      cancelOrder: async (id) => {
        const o = orders.find((x) => x.id === id);
        if (!o || o.status !== 'PLACED') return null;
        o.status = 'CANCELLED'; slot.booked--;
        return o;
      },
    },
    menu: {
      getItemsByIds: async (ids) => ids.filter((i) => stock.has(i)).map((i) => {
        const s = stock.get(i)!;
        return { _id: i, stall_id: s.stall_id, name: s.name, price: s.price, stock: s.stock, is_available: s.on, category: 'juice', description: '', tags: [], attributes: {} } as MenuItem;
      }),
      reserveStock: async (lines) => {
        const taken: typeof lines = [];
        for (const l of lines) {
          const s = stock.get(l.menuItemId)!;
          if (!s.on || s.stock < l.quantity) { for (const t of taken) stock.get(t.menuItemId)!.stock += t.quantity; return l.menuItemId; }
          s.stock -= l.quantity; taken.push(l);
        }
        return null;
      },
      releaseStock: async (lines) => {
        if (fail.releaseStock) throw new Error('mongo down');
        for (const l of lines) stock.get(l.menuItemId)!.stock += l.quantity;
      },
    },
    sagas: {
      create: async (s) => {
        if (sagas.has(s._id)) throw Object.assign(new Error('dup'), { code: 11000 });
        sagas.set(s._id, { ...s, status: 'PENDING', created_at: new Date(), updated_at: new Date(0) }); // updated_at old => "stale"
      },
      mark: async (id, status, extra) => { const s = sagas.get(id)!; Object.assign(s, { status, ...extra, updated_at: new Date() }); },
      findByStatus: async (statuses: SagaStatus[]) => [...sagas.values()].filter((s) => statuses.includes(s.status)), // fake ignores age: the age filter itself lives in the real Mongo query
    },
  };
  return { deps, stock, orders, sagas, slot, fail };
}

const req = (rid: string, items = [{ menuItemId: ID_A, quantity: 2 }]) => ({ requestId: rid, studentId: 7, stallId: 1, slotId: 1, items });
let w: ReturnType<typeof world>;
beforeEach(() => { w = world(); });

describe('happy path', () => {
  it('snapshots name+price, reserves stock, creates order, commits saga', async () => {
    const o = await placeOrder(req('r1'), w.deps);
    expect(o.totalAmount).toBe(80);
    expect(o.items[0]).toMatchObject({ name: 'Orange Juice', unitPrice: 40, quantity: 2 });
    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
  });
  it('is idempotent: same requestId twice -> ONE order, stock taken once', async () => {
    const a = await placeOrder(req('r1'), w.deps), b = await placeOrder(req('r1'), w.deps);
    expect(b.id).toBe(a.id);
    expect(w.orders).toHaveLength(1);
    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });
  it('merges duplicate cart lines', async () => {
    const o = await placeOrder(req('r1', [{ menuItemId: ID_A, quantity: 1 }, { menuItemId: ID_A, quantity: 1 }]), w.deps);
    expect(o.items).toHaveLength(1); expect(o.items[0].quantity).toBe(2);
  });
});

describe('validation (nothing is touched when the cart is bad)', () => {
  it('rejects sold-out, too-many, wrong-stall, unknown items', async () => {
    w.stock.get(ID_B)!.on = false;
    const r = await checkCart(1, [{ menuItemId: ID_B, quantity: 1 }, { menuItemId: ID_A, quantity: 9 }, { menuItemId: ID_OTHER, quantity: 1 }, { menuItemId: 'd'.repeat(24), quantity: 1 }], w.deps);
    expect(r.problems.join('|')).toMatch(/sold out/);
    expect(r.problems.join('|')).toMatch(/Only 3 left/);
    expect(r.problems.join('|')).toMatch(/different stall/);
    expect(r.problems.join('|')).toMatch(/no longer on the menu/);
  });
  it('placeOrder throws 409 and leaves stock + saga log untouched', async () => {
    await expect(placeOrder(req('r1', [{ menuItemId: ID_A, quantity: 9 }]), w.deps)).rejects.toMatchObject({ status: 409 });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.size).toBe(0);
  });
});

describe('failure handling (compensation)', () => {
  it('slot full -> stock is given back, saga COMPENSATED, student sees 409', async () => {
    w = world({ slotCapacity: 0 });
    await expect(placeOrder(req('r1'), w.deps)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/slot/i) });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
    expect(w.orders).toHaveLength(0);
  });
  it('PostgreSQL down -> stock restored, 503, no order', async () => {
    w.fail.createOrder = new Error('connection refused');
    await expect(placeOrder(req('r1'), w.deps)).rejects.toMatchObject({ status: 503 });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
  });
  it('UNKNOWN outcome: Postgres committed but the reply was lost -> treated as success, stock NOT restored', async () => {
    w.fail.createButLoseReply = true;
    const o = await placeOrder(req('r1'), w.deps);
    expect(o.requestId).toBe('r1');
    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
  });
  it('compensation itself fails -> RESTOCK_PENDING, then reconcile fixes the stock', async () => {
    w.fail.createOrder = new Error('pg down'); w.fail.releaseStock = true;
    await expect(placeOrder(req('r1'), w.deps)).rejects.toMatchObject({ status: 503 });
    expect(w.stock.get(ID_A)!.stock).toBe(1); // still missing
    expect(w.sagas.get('r1')!.status).toBe('RESTOCK_PENDING');
    w.fail.releaseStock = false;
    expect(await reconcile(w.deps)).toMatchObject({ restocked: 1 });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
  });
  it('same requestId already in flight -> 409', async () => {
    await w.deps.sagas.create({ _id: 'r1', student_id: 7, stall_id: 1, lines: [] });
    await expect(placeOrder(req('r1'), w.deps)).rejects.toMatchObject({ status: 409 });
  });
});

describe('concurrency on stock', () => {
  it('two students racing for the last unit: exactly one wins, nothing goes negative', async () => {
    const one = (rid: string, sid: number) => placeOrder({ ...req(rid, [{ menuItemId: ID_B, quantity: 1 }]), studentId: sid }, w.deps);
    const results = await Promise.allSettled([one('x1', 1), one('x2', 2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(w.stock.get(ID_B)!.stock).toBe(0);
    expect(w.orders).toHaveLength(1);
  });
});

describe('reconciler (recovering from crashes)', () => {
  it('crash AFTER reserving stock but BEFORE creating the order -> stock released', async () => {
    await w.deps.sagas.create({ _id: 'crash1', student_id: 7, stall_id: 1, lines: [{ menuItemId: ID_A, quantity: 2 }] });
    await w.deps.menu.reserveStock([{ menuItemId: ID_A, quantity: 2 }]);
    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(await reconcile(w.deps)).toMatchObject({ compensated: 1 });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('crash1')!.status).toBe('COMPENSATED');
  });
  it('crash AFTER the order exists but BEFORE marking the saga -> saga marked COMMITTED, stock kept', async () => {
    w.deps.sagas.mark = async () => { throw new Error('mongo blip'); }; // can't close the saga
    const o = await placeOrder(req('r1'), w.deps);
    w = { ...w, deps: { ...w.deps, sagas: { ...w.deps.sagas, mark: async (id, status, extra) => { Object.assign(w.sagas.get(id)!, { status, ...extra, updated_at: new Date() }); } } } };
    expect(w.sagas.get('r1')!.status).toBe('PENDING');
    expect(await reconcile(w.deps)).toMatchObject({ committed: 1 });
    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
    expect(w.sagas.get('r1')!.order_id).toBe(o.id);
    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });
});

describe('cancel', () => {
  it('cancelling a PLACED order frees the slot and returns stock', async () => {
    const o = await placeOrder(req('r1'), w.deps);
    await cancelOrder(o.id, 7, w.deps);
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.slot.booked).toBe(0);
    expect(w.sagas.get('r1')!.status).toBe('CANCELLED');
  });
  it('cannot cancel once preparing, and stock is not double-restored', async () => {
    const o = await placeOrder(req('r1'), w.deps);
    w.orders[0].status = 'PREPARING';
    await expect(cancelOrder(o.id, 7, w.deps)).rejects.toMatchObject({ status: 409 });
    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });
});
