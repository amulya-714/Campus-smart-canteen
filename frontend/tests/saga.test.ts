/**
 * Cross-database consistency tests.
 *
 * We use in-memory fakes for MongoDB (stock) and PostgreSQL
 * (orders/slots), so these tests run anywhere and we can inject
 * failures on demand.
 *
 * The stock fake tracks reservation and release operation IDs to
 * simulate idempotent stock updates.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  cancelOrder,
  checkCart,
  placeOrder,
  reconcile,
  type SagaDeps,
} from '@/lib/services/orderSaga';

import { SlotFullError } from '@/lib/postgres/types';
import type { Saga, SagaStatus } from '@/lib/mongo/sagaRepo';
import type { MenuItem, Order } from '@/lib/types';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);
const ID_OTHER = 'c'.repeat(24);

function world(opts: { slotCapacity?: number } = {}) {
  const stock = new Map<
    string,
    {
      stall_id: number;
      name: string;
      price: number;
      stock: number;
      on: boolean;
    }
  >([
    [
      ID_A,
      {
        stall_id: 1,
        name: 'Orange Juice',
        price: 40,
        stock: 3,
        on: true,
      },
    ],
    [
      ID_B,
      {
        stall_id: 1,
        name: 'Mosambi',
        price: 30,
        stock: 1,
        on: true,
      },
    ],
    [
      ID_OTHER,
      {
        stall_id: 2,
        name: 'Sandwich',
        price: 60,
        stock: 9,
        on: true,
      },
    ],
  ]);

  // Simulates the stock_operations array in MongoDB.
  const stockOperations = new Set<string>();

  const orders: Order[] = [];
  const sagas = new Map<string, Saga>();

  const slot = {
    capacity: opts.slotCapacity ?? 15,
    booked: 0,
  };

  const fail = {
    createOrder: null as null | Error,
    releaseStock: false,
    orderLookupThrows: false,
    createButLoseReply: false,
  };

  const deps: SagaDeps = {
    db: {
      getStall: async (id) =>
        id === 1 || id === 2
          ? {
              id,
              name: 'S',
              location: '',
              description: '',
              isActive: true,
            }
          : null,

      getOrderByRequestId: async (requestId) => {
        if (fail.orderLookupThrows) {
          throw new Error('pg down');
        }

        return orders.find((order) => order.requestId === requestId) ?? null;
      },

      createOrder: async (input) => {
        if (fail.createOrder) {
          throw fail.createOrder;
        }

        if (slot.booked >= slot.capacity) {
          throw new SlotFullError();
        }

        slot.booked++;

        const order: Order = {
          id: orders.length + 1,
          requestId: input.requestId,
          studentId: input.studentId,
          stallId: input.stallId,
          slotId: input.slotId,
          status: 'PLACED',
          totalAmount: input.totalAmount,
          createdAt: new Date().toISOString(),
          items: input.items,
        };

        orders.push(order);

        if (fail.createButLoseReply) {
          throw new Error('timeout after commit');
        }

        return order;
      },

      cancelOrder: async (id) => {
        const order = orders.find((item) => item.id === id);

        if (!order || order.status !== 'PLACED') {
          return null;
        }

        order.status = 'CANCELLED';
        slot.booked--;

        return order;
      },
    },

    menu: {
      getItemsByIds: async (ids) =>
        ids
          .filter((id) => stock.has(id))
          .map((id) => {
            const item = stock.get(id)!;

            return {
              _id: id,
              stall_id: item.stall_id,
              name: item.name,
              price: item.price,
              stock: item.stock,
              is_available: item.on,
              category: 'juice',
              description: '',
              tags: [],
              attributes: {},
            } as MenuItem;
          }),

      /**
       * Reserves stock one item at a time.
       *
       * Repeating the same reservation with the same request ID
       * must not deduct stock twice.
       */
      reserveStock: async (lines, requestId) => {
        const taken: typeof lines = [];

        for (const line of lines) {
          const item = stock.get(line.menuItemId);

          if (!item) {
            await releaseTaken(taken, requestId);
            return line.menuItemId;
          }

          const reserveKey =
            `reserve:${requestId}:${line.menuItemId}`;

          const releaseKey =
            `release:${requestId}:${line.menuItemId}`;

          // A reservation that has already been restored cannot
          // be reused as an active reservation.
          if (stockOperations.has(releaseKey)) {
            await releaseTaken(taken, requestId);
            return line.menuItemId;
          }

          // The reservation already exists and has not been
          // restored, so do not deduct stock again.
          if (stockOperations.has(reserveKey)) {
            taken.push(line);
            continue;
          }

          if (!item.on || item.stock < line.quantity) {
            await releaseTaken(taken, requestId);
            return line.menuItemId;
          }

          item.stock -= line.quantity;
          stockOperations.add(reserveKey);
          taken.push(line);
        }

        return null;
      },

      /**
       * Restores stock reserved by this request.
       *
       * Repeated calls with the same request ID must not increase
       * stock more than once.
       */
      releaseStock: async (lines, requestId) => {
        if (fail.releaseStock) {
          throw new Error('mongo down');
        }

        for (const line of lines) {
          const reserveKey =
            `reserve:${requestId}:${line.menuItemId}`;

          const releaseKey =
            `release:${requestId}:${line.menuItemId}`;

          // Only restore an existing reservation, and restore it
          // only if it has not already been released.
          if (
            stockOperations.has(reserveKey) &&
            !stockOperations.has(releaseKey)
          ) {
            stock.get(line.menuItemId)!.stock += line.quantity;
            stockOperations.add(releaseKey);
          }
        }
      },
    },

    sagas: {
      create: async (saga) => {
        if (sagas.has(saga._id)) {
          throw Object.assign(new Error('dup'), { code: 11000 });
        }

        sagas.set(saga._id, {
          ...saga,
          status: 'PENDING',
          created_at: new Date(),
          updated_at: new Date(0),
        });
      },

      mark: async (id, status, extra) => {
        const saga = sagas.get(id)!;

        Object.assign(saga, {
          status,
          ...extra,
          updated_at: new Date(),
        });
      },

      findByStatus: async (statuses: SagaStatus[]) =>
        [...sagas.values()].filter((saga) =>
          statuses.includes(saga.status),
        ),
    },
  };

  /**
   * Internal compensation used by the fake reservation function.
   * It follows the same request ID as the original reservation.
   */
  async function releaseTaken(
    lines: { menuItemId: string; quantity: number }[],
    requestId: string,
  ) {
    if (fail.releaseStock) {
      throw new Error('mongo down');
    }

    for (const line of lines) {
      const reserveKey =
        `reserve:${requestId}:${line.menuItemId}`;

      const releaseKey =
        `release:${requestId}:${line.menuItemId}`;

      if (
        stockOperations.has(reserveKey) &&
        !stockOperations.has(releaseKey)
      ) {
        stock.get(line.menuItemId)!.stock += line.quantity;
        stockOperations.add(releaseKey);
      }
    }
  }

  return {
    deps,
    stock,
    stockOperations,
    orders,
    sagas,
    slot,
    fail,
  };
}

const req = (
  requestId: string,
  items = [{ menuItemId: ID_A, quantity: 2 }],
) => ({
  requestId,
  studentId: 7,
  stallId: 1,
  slotId: 1,
  items,
});

let w: ReturnType<typeof world>;

beforeEach(() => {
  w = world();
});

describe('happy path', () => {
  it('snapshots name and price, reserves stock, creates order, commits saga', async () => {
    const order = await placeOrder(req('r1'), w.deps);

    expect(order.totalAmount).toBe(80);

    expect(order.items[0]).toMatchObject({
      name: 'Orange Juice',
      unitPrice: 40,
      quantity: 2,
    });

    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
  });

  it('is idempotent: same request ID twice creates one order and reserves stock once', async () => {
    const first = await placeOrder(req('r1'), w.deps);
    const second = await placeOrder(req('r1'), w.deps);

    expect(second.id).toBe(first.id);
    expect(w.orders).toHaveLength(1);
    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });

  it('merges duplicate cart lines', async () => {
    const order = await placeOrder(
      req('r1', [
        { menuItemId: ID_A, quantity: 1 },
        { menuItemId: ID_A, quantity: 1 },
      ]),
      w.deps,
    );

    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
  });
});

describe('validation (nothing is touched when the cart is bad)', () => {
  it('rejects sold-out, excessive, wrong-stall and unknown items', async () => {
    w.stock.get(ID_B)!.on = false;

    const result = await checkCart(
      1,
      [
        { menuItemId: ID_B, quantity: 1 },
        { menuItemId: ID_A, quantity: 9 },
        { menuItemId: ID_OTHER, quantity: 1 },
        { menuItemId: 'd'.repeat(24), quantity: 1 },
      ],
      w.deps,
    );

    expect(result.problems.join('|')).toMatch(/sold out/);
    expect(result.problems.join('|')).toMatch(/Only 3 left/);
    expect(result.problems.join('|')).toMatch(/different stall/);
    expect(result.problems.join('|')).toMatch(/no longer on the menu/);
  });

  it('placeOrder throws 409 and leaves stock and saga log untouched', async () => {
    await expect(
      placeOrder(req('r1', [{ menuItemId: ID_A, quantity: 9 }]), w.deps),
    ).rejects.toMatchObject({ status: 409 });

    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.size).toBe(0);
  });
});

describe('failure handling (compensation)', () => {
  it('slot full: stock is restored, saga COMPENSATED, student sees 409', async () => {
    w = world({ slotCapacity: 0 });

    await expect(
      placeOrder(req('r1'), w.deps),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/slot/i),
    });

    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
    expect(w.orders).toHaveLength(0);
  });

  it('PostgreSQL down: stock restored, 503, no order', async () => {
    w.fail.createOrder = new Error('connection refused');

    await expect(
      placeOrder(req('r1'), w.deps),
    ).rejects.toMatchObject({ status: 503 });

    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
  });

  it('UNKNOWN outcome: PostgreSQL committed but reply was lost, so stock is not restored', async () => {
    w.fail.createButLoseReply = true;

    const order = await placeOrder(req('r1'), w.deps);

    expect(order.requestId).toBe('r1');
    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
  });

  it('compensation fails: RESTOCK_PENDING, then reconcile restores stock', async () => {
    w.fail.createOrder = new Error('pg down');
    w.fail.releaseStock = true;

    await expect(
      placeOrder(req('r1'), w.deps),
    ).rejects.toMatchObject({ status: 503 });

    expect(w.stock.get(ID_A)!.stock).toBe(1);
    expect(w.sagas.get('r1')!.status).toBe('RESTOCK_PENDING');

    w.fail.releaseStock = false;

    expect(await reconcile(w.deps)).toMatchObject({ restocked: 1 });
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('r1')!.status).toBe('COMPENSATED');
  });

  it('same request ID already in flight returns 409', async () => {
    await w.deps.sagas.create({
      _id: 'r1',
      student_id: 7,
      stall_id: 1,
      lines: [],
    });

    await expect(
      placeOrder(req('r1'), w.deps),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('concurrency on stock', () => {
  it('two students racing for the last unit: exactly one wins and stock never goes negative', async () => {
    const placeForStudent = (requestId: string, studentId: number) =>
      placeOrder(
        {
          ...req(requestId, [
            { menuItemId: ID_B, quantity: 1 },
          ]),
          studentId,
        },
        w.deps,
      );

    const results = await Promise.allSettled([
      placeForStudent('x1', 1),
      placeForStudent('x2', 2),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);

    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);

    expect(w.stock.get(ID_B)!.stock).toBe(0);
    expect(w.orders).toHaveLength(1);
  });
});

describe('reconciler (recovering from crashes)', () => {
  it('crash after reserving stock but before creating the order: stock released', async () => {
    await w.deps.sagas.create({
      _id: 'crash1',
      student_id: 7,
      stall_id: 1,
      lines: [
        { menuItemId: ID_A, quantity: 2 },
      ],
    });

    await w.deps.menu.reserveStock(
      [{ menuItemId: ID_A, quantity: 2 }],
      'crash1',
    );

    expect(w.stock.get(ID_A)!.stock).toBe(1);

    expect(await reconcile(w.deps)).toMatchObject({
      compensated: 1,
    });

    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.sagas.get('crash1')!.status).toBe('COMPENSATED');
  });

  it('crash after the order exists but before marking the saga: saga marked COMMITTED and stock kept', async () => {
    w.deps.sagas.mark = async () => {
      throw new Error('mongo blip');
    };

    const order = await placeOrder(req('r1'), w.deps);

    w = {
      ...w,
      deps: {
        ...w.deps,
        sagas: {
          ...w.deps.sagas,
          mark: async (id, status, extra) => {
            Object.assign(w.sagas.get(id)!, {
              status,
              ...extra,
              updated_at: new Date(),
            });
          },
        },
      },
    };

    expect(w.sagas.get('r1')!.status).toBe('PENDING');

    expect(await reconcile(w.deps)).toMatchObject({
      committed: 1,
    });

    expect(w.sagas.get('r1')!.status).toBe('COMMITTED');
    expect(w.sagas.get('r1')!.order_id).toBe(order.id);
    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });
});

describe('cancel', () => {
  it('cancelling a PLACED order frees the slot and restores stock', async () => {
    const order = await placeOrder(req('r1'), w.deps);

    await cancelOrder(order.id, 7, w.deps);

    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.slot.booked).toBe(0);
    expect(w.sagas.get('r1')!.status).toBe('CANCELLED');
  });

  it('cannot cancel once preparing, and stock is not restored', async () => {
    const order = await placeOrder(req('r1'), w.deps);

    w.orders[0].status = 'PREPARING';

    await expect(
      cancelOrder(order.id, 7, w.deps),
    ).rejects.toMatchObject({ status: 409 });

    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });

  it('restores stock only once when releaseStock is called repeatedly', async () => {
    const order = await placeOrder(req('r1'), w.deps);

    expect(w.stock.get(ID_A)!.stock).toBe(1);

    const lines = [
      { menuItemId: ID_A, quantity: 2 },
    ];

    await w.deps.menu.releaseStock(lines, order.requestId);

    expect(w.stock.get(ID_A)!.stock).toBe(3);

    // A repeated release must not increase stock again.
    await w.deps.menu.releaseStock(lines, order.requestId);

    expect(w.stock.get(ID_A)!.stock).toBe(3);
  });

  it('does not deduct stock twice for a repeated reservation with the same request ID', async () => {
    const lines = [
      { menuItemId: ID_A, quantity: 2 },
    ];

    expect(
      await w.deps.menu.reserveStock(lines, 'retry-reservation'),
    ).toBeNull();

    expect(w.stock.get(ID_A)!.stock).toBe(1);

    expect(
      await w.deps.menu.reserveStock(lines, 'retry-reservation'),
    ).toBeNull();

    expect(w.stock.get(ID_A)!.stock).toBe(1);
  });

  it('restores an earlier reservation when a later item is out of stock', async () => {
    const result = await w.deps.menu.reserveStock(
      [
        { menuItemId: ID_A, quantity: 2 },
        { menuItemId: ID_B, quantity: 2 },
      ],
      'partial-reservation',
    );

    expect(result).toBe(ID_B);

    // ID_A was reserved first but must be restored after ID_B fails.
    expect(w.stock.get(ID_A)!.stock).toBe(3);
    expect(w.stock.get(ID_B)!.stock).toBe(1);
  });
});