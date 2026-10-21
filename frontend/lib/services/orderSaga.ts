/**
 * ORDER PLACEMENT = a SAGA across two databases.  (Read docs/CONSISTENCY_DESIGN.md)
 *
 * Why not a normal transaction? PostgreSQL and MongoDB can't share one, so we
 * do a series of local steps and, if a later step fails, UNDO the earlier ones
 * with a "compensating action".
 *
 *   Step 0  Idempotency check   same requestId already has an order?  -> return it
 *   Step 1  Validate + snapshot read MongoDB: items exist, belong to stall, in stock; copy name+price
 *   Step 2  Log saga PENDING     MongoDB `order_sagas` (survives crashes)
 *   Step 3  Reserve stock        MongoDB atomic $inc (stock >= qty)           [compensate: give stock back]
 *   Step 4  Create order         PostgreSQL transaction (Person 1: lock slot, check capacity, insert)
 *   Step 5  Mark saga COMMITTED
 *
 *   Step 4 fails (slot full, DB down)  -> release stock, saga COMPENSATED
 *   Crash between steps               -> `npm run reconcile` finishes or undoes the saga later
 */
import type { PgAdapter } from '@/lib/postgres/types';
import { SlotFullError, SlotUnavailableError } from '@/lib/postgres/types';
import type { MenuItem, Order, OrderItem } from '@/lib/types';
import { ApiError } from '@/lib/http';
import type { StockLine } from '@/lib/mongo/menuRepo';
import type { SagaStore } from '@/lib/mongo/sagaRepo';

export interface MenuStock {
  getItemsByIds(ids: string[]): Promise<MenuItem[]>;
  reserveStock(lines: StockLine[]): Promise<string | null>;
  releaseStock(lines: StockLine[]): Promise<void>;
}
export interface SagaDeps {
  db: Pick<PgAdapter, 'getOrderByRequestId' | 'createOrder' | 'cancelOrder' | 'getStall'>;
  menu: MenuStock;
  sagas: SagaStore;
}

export interface CartLine { menuItemId: string; quantity: number }
export interface PlaceOrderInput { requestId: string; studentId: number; stallId: number; slotId: number; items: CartLine[] }

export interface CartCheck { lines: OrderItem[]; total: number; problems: string[] }

/** Step 1. Read-only: checks the cart against MongoDB and builds price/name snapshots. */
export async function checkCart(stallId: number, cart: CartLine[], deps: Pick<SagaDeps, 'db' | 'menu'>): Promise<CartCheck> {
  const problems: string[] = [];
  const stall = await deps.db.getStall(stallId);
  if (!stall || !stall.isActive) problems.push('This stall is not taking orders');

  // merge duplicate lines of the same item
  const merged = new Map<string, number>();
  for (const l of cart) merged.set(l.menuItemId, (merged.get(l.menuItemId) ?? 0) + l.quantity);

  const docs = new Map((await deps.menu.getItemsByIds([...merged.keys()])).map((d) => [d._id, d]));
  const lines: OrderItem[] = [];
  for (const [id, qty] of merged) {
    const d = docs.get(id);
    if (!d) problems.push('An item in your cart is no longer on the menu');
    else if (d.stall_id !== stallId) problems.push(`${d.name} belongs to a different stall`);
    else if (!d.is_available || d.stock <= 0) problems.push(`${d.name} is sold out`);
    else if (d.stock < qty) problems.push(`Only ${d.stock} left of ${d.name}`);
    else lines.push({ menuItemId: id, name: d.name, unitPrice: d.price, quantity: qty }); // <- the snapshot
  }
  const total = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  return { lines, total, problems };
}

async function safe(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { console.error('[saga] non-fatal:', e); } }

/** Compensation: undo Step 3. If even this fails, leave a RESTOCK_PENDING marker for the reconciler. */
async function compensate(deps: SagaDeps, requestId: string, stock: StockLine[], reason: string) {
  try {
    await deps.menu.releaseStock(stock);
    await safe(() => deps.sagas.mark(requestId, 'COMPENSATED', { reason }));
  } catch (e) {
    console.error('[saga] release failed, marking RESTOCK_PENDING', e);
    await safe(() => deps.sagas.mark(requestId, 'RESTOCK_PENDING', { reason }));
  }
}

export async function placeOrder(input: PlaceOrderInput, deps: SagaDeps): Promise<Order> {
  // Step 0: idempotency (a double-click or network retry must not create two orders)
  const prior = await deps.db.getOrderByRequestId(input.requestId);
  if (prior) return prior;

  // Step 1: validate + snapshot
  const { lines, total, problems } = await checkCart(input.stallId, input.items, deps);
  if (problems.length) throw new ApiError(409, problems.join('. '));
  if (!lines.length) throw new ApiError(400, 'Your cart is empty');
  const stock: StockLine[] = lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity }));

  // Step 2: write the saga log BEFORE touching any stock
  try {
    await deps.sagas.create({ _id: input.requestId, student_id: input.studentId, stall_id: input.stallId, lines: stock });
  } catch (e: any) {
    if (e?.code === 11000) throw new ApiError(409, 'This order is already being processed');
    throw e;
  }

  // Step 3: reserve stock (atomic per item, all-or-nothing)
  const soldOut = await deps.menu.reserveStock(stock);
  if (soldOut) {
    await safe(() => deps.sagas.mark(input.requestId, 'COMPENSATED', { reason: 'out_of_stock' }));
    throw new ApiError(409, 'Someone just took the last of an item in your cart. Please review it.');
  }

  // Step 4: create the order in PostgreSQL
  let order: Order;
  try {
    order = await deps.db.createOrder({ ...input, items: lines, totalAmount: total });
  } catch (e) {
    // "Unknown outcome" guard: the DB may have committed but the reply was lost (timeout).
    const maybe = await deps.db.getOrderByRequestId(input.requestId).catch(() => null);
    if (!maybe) {
      await compensate(deps, input.requestId, stock, e instanceof Error ? e.name : 'unknown');
      if (e instanceof SlotFullError) throw new ApiError(409, 'That pickup slot just filled up. Pick another time.');
      if (e instanceof SlotUnavailableError) throw new ApiError(409, e.message);
      console.error('[saga] createOrder failed', e);
      throw new ApiError(503, 'We could not place your order. Nothing was reserved. Please try again.');
    }
    order = maybe; // it actually went through
  }

  // Step 5: close the saga. If this fails the order is still valid; the reconciler tidies the log.
  await safe(() => deps.sagas.mark(input.requestId, 'COMMITTED', { order_id: order.id }));
  return order;
}

/** Student cancels before cooking starts: PostgreSQL first (source of truth), then give stock back. */
export async function cancelOrder(orderId: number, studentId: number, deps: SagaDeps): Promise<Order> {
  const order = await deps.db.cancelOrder(orderId, studentId);
  if (!order) throw new ApiError(409, 'This order can no longer be cancelled');
  const stock = order.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
  try {
    await deps.menu.releaseStock(stock);
    await safe(() => deps.sagas.mark(order.requestId, 'CANCELLED'));
  } catch {
    await safe(() => deps.sagas.mark(order.requestId, 'RESTOCK_PENDING', { reason: 'cancelled' }));
  }
  return order;
}

/** Recovery job (npm run reconcile). Run every few minutes, e.g. from cron. */
export async function reconcile(deps: SagaDeps, olderThanMs = 2 * 60_000) {
  const result = { committed: 0, compensated: 0, restocked: 0 };
  const stuck = await deps.sagas.findByStatus(['PENDING', 'RESTOCK_PENDING'], olderThanMs);
  for (const s of stuck) {
    const order = await deps.db.getOrderByRequestId(s._id);
    if (s.status === 'PENDING') {
      if (order) { await deps.sagas.mark(s._id, 'COMMITTED', { order_id: order.id }); result.committed++; }
      else { await deps.menu.releaseStock(s.lines); await deps.sagas.mark(s._id, 'COMPENSATED', { reason: 'reconciled' }); result.compensated++; }
    } else {
      await deps.menu.releaseStock(s.lines);
      await deps.sagas.mark(s._id, order?.status === 'CANCELLED' ? 'CANCELLED' : 'COMPENSATED');
      result.restocked++;
    }
  }
  return result;
}
