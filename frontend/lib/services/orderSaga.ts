
/**
 * ORDER PLACEMENT = a SAGA across PostgreSQL and MongoDB.
 *
 * PostgreSQL and MongoDB cannot share a transaction, so each database
 * performs local operations and failures are handled with compensation.
 */

import type { PgAdapter } from '@/lib/postgres/types';
import { SlotFullError, SlotUnavailableError } from '@/lib/postgres/types';
import type { MenuItem, Order, OrderItem } from '@/lib/types';
import { ApiError } from '@/lib/http';
import type { StockLine } from '@/lib/mongo/menuRepo';
import type { SagaStore } from '@/lib/mongo/sagaRepo';

export interface MenuStock {
  getItemsByIds(ids: string[]): Promise<MenuItem[]>;
  reserveStock(lines: StockLine[], requestId: string): Promise<string | null>;
  releaseStock(lines: StockLine[], requestId: string): Promise<void>;
}

export interface SagaDeps {
  db: Pick<
    PgAdapter,
    'getOrderByRequestId' | 'createOrder' | 'cancelOrder' | 'getStall'
  >;
  menu: MenuStock;
  sagas: SagaStore;
}

export interface CartLine {
  menuItemId: string;
  quantity: number;
}

export interface PlaceOrderInput {
  requestId: string;
  studentId: number;
  stallId: number;
  slotId: number;
  items: CartLine[];
}

export interface CartCheck {
  lines: OrderItem[];
  total: number;
  problems: string[];
}

/** Validates the cart and builds price/name snapshots from MongoDB. */
export async function checkCart(
  stallId: number,
  cart: CartLine[],
  deps: Pick<SagaDeps, 'db' | 'menu'>,
): Promise<CartCheck> {
  const problems: string[] = [];

  const stall = await deps.db.getStall(stallId);
  if (!stall || !stall.isActive) {
    problems.push('This stall is not taking orders');
  }

  // Merge duplicate lines for the same menu item.
  const merged = new Map<string, number>();

  for (const line of cart) {
    merged.set(
      line.menuItemId,
      (merged.get(line.menuItemId) ?? 0) + line.quantity,
    );
  }

  const docs = new Map(
    (await deps.menu.getItemsByIds([...merged.keys()])).map((item) => [
      item._id,
      item,
    ]),
  );

  const lines: OrderItem[] = [];

  for (const [id, quantity] of merged) {
    const item = docs.get(id);

    if (!item) {
      problems.push('An item in your cart is no longer on the menu');
    } else if (item.stall_id !== stallId) {
      problems.push(`${item.name} belongs to a different stall`);
    } else if (!item.is_available || item.stock <= 0) {
      problems.push(`${item.name} is sold out`);
    } else if (item.stock < quantity) {
      problems.push(`Only ${item.stock} left of ${item.name}`);
    } else {
      lines.push({
        menuItemId: id,
        name: item.name,
        unitPrice: item.price,
        quantity,
      });
    }
  }

  const total =
    Math.round(
      lines.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        0,
      ) * 100,
    ) / 100;

  return { lines, total, problems };
}

async function safe(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error('[saga] non-fatal:', error);
  }
}

/**
 * Compensates for a failed order.
 * If restoration fails, RESTOCK_PENDING lets reconciliation retry it.
 */
async function compensate(
  deps: SagaDeps,
  requestId: string,
  stock: StockLine[],
  reason: string,
) {
  try {
    await deps.menu.releaseStock(stock, requestId);

    await safe(() =>
      deps.sagas.mark(requestId, 'COMPENSATED', { reason }),
    );
  } catch (error) {
    console.error('[saga] release failed, marking RESTOCK_PENDING', error);

    await safe(() =>
      deps.sagas.mark(requestId, 'RESTOCK_PENDING', { reason }),
    );
  }
}

export async function placeOrder(
  input: PlaceOrderInput,
  deps: SagaDeps,
): Promise<Order> {
  // Step 0: Return an existing order for a repeated request.
  const prior = await deps.db.getOrderByRequestId(input.requestId);
  if (prior) return prior;

  // Step 1: Validate the cart and build snapshots.
  const { lines, total, problems } = await checkCart(
    input.stallId,
    input.items,
    deps,
  );

  if (problems.length) {
    throw new ApiError(409, problems.join('. '));
  }

  if (!lines.length) {
    throw new ApiError(400, 'Your cart is empty');
  }

  const stock: StockLine[] = lines.map((line) => ({
    menuItemId: line.menuItemId,
    quantity: line.quantity,
  }));

  // Step 2: Persist the saga before changing stock.
  try {
    await deps.sagas.create({
      _id: input.requestId,
      student_id: input.studentId,
      stall_id: input.stallId,
      lines: stock,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new ApiError(409, 'This order is already being processed');
    }
    throw error;
  }

  // Step 3: Reserve stock using the request ID for idempotency.
  let soldOut: string | null;

  try {
    soldOut = await deps.menu.reserveStock(stock, input.requestId);
  } catch (error) {
    // A reservation can fail after some lines were deducted.
    // Record the need for recovery; reconciliation will use the same ID.
    await safe(() =>
      deps.sagas.mark(input.requestId, 'RESTOCK_PENDING', {
        reason: 'reservation_error',
      }),
    );

    throw new ApiError(
      503,
      'We could not confirm stock availability. Please check your order status before trying again.',
    );
  }

  if (soldOut) {
    // reserveStock attempts to undo partial reservations itself.
    // If that attempt fails, leave a recovery marker.
    await safe(() =>
      deps.sagas.mark(input.requestId, 'COMPENSATED', {
        reason: 'out_of_stock',
      }),
    );

    throw new ApiError(
      409,
      'Someone just took the last of an item in your cart. Please review it.',
    );
  }

  // Step 4: Create the order in PostgreSQL.
  let order: Order;

  try {
    order = await deps.db.createOrder({
      ...input,
      items: lines,
      totalAmount: total,
    });
  } catch (error) {
    // The database might have committed even if the response was lost.
    const maybe = await deps.db
      .getOrderByRequestId(input.requestId)
      .catch(() => null);

    if (!maybe) {
      await compensate(
        deps,
        input.requestId,
        stock,
        error instanceof Error ? error.name : 'unknown',
      );

      if (error instanceof SlotFullError) {
        throw new ApiError(
          409,
          'That pickup slot just filled up. Pick another time.',
        );
      }

      if (error instanceof SlotUnavailableError) {
        throw new ApiError(409, error.message);
      }

      console.error('[saga] createOrder failed', error);

      throw new ApiError(
        503,
        'We could not place your order. Please check your order status before trying again.',
      );
    }

    order = maybe;
  }

  // Step 5: Mark the saga complete.
  await safe(() =>
    deps.sagas.mark(input.requestId, 'COMMITTED', {
      order_id: order.id,
    }),
  );

  return order;
}

/** Cancels an order, then restores its reserved stock. */
export async function cancelOrder(
  orderId: number,
  studentId: number,
  deps: SagaDeps,
): Promise<Order> {
  const order = await deps.db.cancelOrder(orderId, studentId);

  if (!order) {
    throw new ApiError(409, 'This order can no longer be cancelled');
  }

  const stock = order.items.map((item) => ({
    menuItemId: item.menuItemId,
    quantity: item.quantity,
  }));

  try {
    await deps.menu.releaseStock(stock, order.requestId);

    await safe(() => deps.sagas.mark(order.requestId, 'CANCELLED'));
  } catch {
    await safe(() =>
      deps.sagas.mark(order.requestId, 'RESTOCK_PENDING', {
        reason: 'cancelled',
      }),
    );
  }

  return order;
}

/** Recovery job: run periodically using npm run reconcile. */
export async function reconcile(
  deps: SagaDeps,
  olderThanMs = 2 * 60_000,
) {
  const result = {
    committed: 0,
    compensated: 0,
    restocked: 0,
  };

  const stuck = await deps.sagas.findByStatus(
    ['PENDING', 'RESTOCK_PENDING'],
    olderThanMs,
  );

  for (const saga of stuck) {
    const order = await deps.db.getOrderByRequestId(saga._id);

    if (saga.status === 'PENDING') {
      if (order) {
        await deps.sagas.mark(saga._id, 'COMMITTED', {
          order_id: order.id,
        });
        result.committed++;
      } else {
        await deps.menu.releaseStock(saga.lines, saga._id);

        await deps.sagas.mark(saga._id, 'COMPENSATED', {
          reason: 'reconciled',
        });

        result.compensated++;
      }
    } else {
      await deps.menu.releaseStock(saga.lines, saga._id);

      await deps.sagas.mark(
        saga._id,
        order?.status === 'CANCELLED' ? 'CANCELLED' : 'COMPENSATED',
      );

      result.restocked++;
    }
  }

  return result;
}
