
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PersonOneAdapter } from '../lib/postgres/personOneAdapter';
import type { CreateOrderInput } from '../lib/postgres/types';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://localhost/campus_smart_canteen_test';

if (!databaseUrl.includes('campus_smart_canteen_test')) {
  throw new Error(
    'Safety check failed: tests must use campus_smart_canteen_test',
  );
}

process.env.DATABASE_URL = databaseUrl;

const sql = new Pool({
  connectionString: databaseUrl,
  max: 10,
});

const db = new PersonOneAdapter();

let stallId: number | undefined;
let studentId: number | undefined;
let secondStudentId: number | undefined;

const createdRequestIds: string[] = [];
const createdSlotIds: number[] = [];

function makeOrderInput(
  requestId: string,
  student: number,
  slot: number,
  quantity = 1,
): CreateOrderInput {
  return {
    requestId,
    studentId: student,
    stallId: stallId!,
    slotId: slot,
    totalAmount: 55 * quantity,
    items: [
      {
        menuItemId: '0123456789abcdef01234567',
        name: 'Test Cheese Toast',
        unitPrice: 55,
        quantity,
      },
    ],
  };
}

async function makeSlot(capacity: number): Promise<number> {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setSeconds(0, 0);

  // Keep trying later times until the unique stall/start constraint is satisfied.
  for (let attempt = 0; attempt < 180; attempt++) {
    const existing = await sql.query(
      `SELECT 1
       FROM pickup_slots
       WHERE stall_id = $1
         AND slot_start = $2`,
      [stallId, start.toISOString()],
    );

    if (existing.rowCount === 0) {
      const end = new Date(start.getTime() + 10 * 60 * 1000);

      try {
        const result = await sql.query(
          `INSERT INTO pickup_slots
             (stall_id, slot_start, slot_end, capacity, booked_count)
           VALUES ($1, $2, $3, $4, 0)
           RETURNING slot_id`,
          [
            stallId,
            start.toISOString(),
            end.toISOString(),
            capacity,
          ],
        );

        const id = Number(result.rows[0].slot_id);
        createdSlotIds.push(id);
        return id;
      } catch (error) {
        // If another process claimed this time, try the next minute.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        ) {
          start.setMinutes(start.getMinutes() + 1);
          continue;
        }

        throw error;
      }
    }

    start.setMinutes(start.getMinutes() + 1);
  }

  throw new Error('Could not create a unique test pickup slot');
}

async function createTestOrder(
  requestId: string,
  student: number,
  slot: number,
  quantity = 1,
) {
  createdRequestIds.push(requestId);

  return db.createOrder(
    makeOrderInput(requestId, student, slot, quantity),
  );
}

beforeAll(async () => {
  const suffix = randomUUID();

  const stall = await sql.query(
    `INSERT INTO stalls (name, location, description, is_active)
     VALUES ($1, 'Test location', 'Automated transaction tests', TRUE)
     RETURNING stall_id`,
    [`Transaction Test ${suffix}`],
  );

  stallId = Number(stall.rows[0].stall_id);

  const student1 = await sql.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Test Student 1', $1, 'test-only-hash', 'student')
     RETURNING user_id`,
    [`test1-${suffix}@example.invalid`],
  );

  studentId = Number(student1.rows[0].user_id);

  const student2 = await sql.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('Test Student 2', $1, 'test-only-hash', 'student')
     RETURNING user_id`,
    [`test2-${suffix}@example.invalid`],
  );

  secondStudentId = Number(student2.rows[0].user_id);
}, 15000);

afterAll(async () => {
  try {
    // Delete only the orders and slots created by this test run.
    if (createdRequestIds.length > 0) {
      await sql.query(
        `DELETE FROM orders
         WHERE client_request_id = ANY($1::text[])`,
        [createdRequestIds],
      );
    }

    if (createdSlotIds.length > 0) {
      await sql.query(
        `DELETE FROM pickup_slots
         WHERE slot_id = ANY($1::int[])`,
        [createdSlotIds],
      );
    }

    if (stallId !== undefined) {
      await sql.query(
        'DELETE FROM stalls WHERE stall_id = $1',
        [stallId],
      );
    }

    if (studentId !== undefined) {
      await sql.query(
        'DELETE FROM users WHERE user_id = $1',
        [studentId],
      );
    }

    if (secondStudentId !== undefined) {
      await sql.query(
        'DELETE FROM users WHERE user_id = $1',
        [secondStudentId],
      );
    }
  } finally {
    await sql.end();
  }
}, 15000);

describe('PostgreSQL adapter transaction safety', () => {
  it('allows only the available number of concurrent bookings', async () => {
    const capacity = 15;
    const testSlotId = await makeSlot(capacity);

    const attempts = Array.from({ length: 20 }, () => {
      const requestId = randomUUID();
      createdRequestIds.push(requestId);

      return db
        .createOrder(
          makeOrderInput(requestId, studentId!, testSlotId),
        )
        .then(() => 'success' as const)
        .catch((error: unknown) => {
          if (
            error instanceof Error &&
            (error.name === 'SlotFullError' ||
              error.message.toLowerCase().includes('slot is full'))
          ) {
            return 'full' as const;
          }

          throw error;
        });
    });

    const results = await Promise.all(attempts);

    expect(results.filter((result) => result === 'success')).toHaveLength(15);
    expect(results.filter((result) => result === 'full')).toHaveLength(5);

    const slot = await sql.query(
      `SELECT booked_count, capacity
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(slot.rows[0].booked_count)).toBe(15);
    expect(Number(slot.rows[0].booked_count)).toBe(
      Number(slot.rows[0].capacity),
    );
  });

  it('returns the existing order for duplicate checkout requests', async () => {
    const testSlotId = await makeSlot(2);
    const requestId = randomUUID();

    const first = await createTestOrder(
      requestId,
      studentId!,
      testSlotId,
    );

    const second = await db.createOrder(
      makeOrderInput(requestId, studentId!, testSlotId),
    );

    expect(second.id).toBe(first.id);

    const orders = await sql.query(
      `SELECT COUNT(*)::int AS count
       FROM orders
       WHERE client_request_id = $1`,
      [requestId],
    );

    expect(Number(orders.rows[0].count)).toBe(1);

    const slot = await sql.query(
      `SELECT booked_count
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(slot.rows[0].booked_count)).toBe(1);
  });

  it('releases pickup-slot capacity when an order is cancelled', async () => {
    const testSlotId = await makeSlot(3);
    const requestId = randomUUID();

    const order = await createTestOrder(
      requestId,
      studentId!,
      testSlotId,
    );

    const before = await sql.query(
      `SELECT booked_count
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(before.rows[0].booked_count)).toBe(1);

    const cancelled = await db.cancelOrder(order.id, studentId!);

    expect(cancelled?.status).toBe('CANCELLED');

    const after = await sql.query(
      `SELECT booked_count
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(after.rows[0].booked_count)).toBe(0);

    // A second cancellation must not decrement capacity again.
    const repeatedCancellation = await db.cancelOrder(
      order.id,
      studentId!,
    );

    expect(repeatedCancellation).toBeNull();

    const final = await sql.query(
      `SELECT booked_count
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(final.rows[0].booked_count)).toBe(0);
  });

  it('rolls back order creation if inserting an order item fails', async () => {
    const testSlotId = await makeSlot(2);
    const requestId = randomUUID();

    createdRequestIds.push(requestId);

    await expect(
      db.createOrder({
        ...makeOrderInput(requestId, secondStudentId!, testSlotId),
        items: [
          {
            menuItemId: 'invalid-test-item',
            name: 'Invalid Test Item',
            unitPrice: 55,
            quantity: 0,
          },
        ],
      }),
    ).rejects.toThrow();

    const order = await sql.query(
      `SELECT order_id
       FROM orders
       WHERE client_request_id = $1`,
      [requestId],
    );

    expect(order.rows).toHaveLength(0);

    const slot = await sql.query(
      `SELECT booked_count
       FROM pickup_slots
       WHERE slot_id = $1`,
      [testSlotId],
    );

    expect(Number(slot.rows[0].booked_count)).toBe(0);
  });
});
