/**
 * PostgreSQL adapter for CampusBite / Campus-smart-canteen.
 *
 * Implements PgAdapter against the schema contract in docs/INTEGRATION_CONTRACT.md.
 * Keep all PostgreSQL access inside this file; application code should use `db`.
 */
import type { PoolClient } from 'pg';
import type { Order, OrderStatus, Role, Slot, Stall, User } from '@/lib/types';
import { pool } from './client';
import {
  DuplicateEmailError,
  SlotFullError,
  SlotUnavailableError,
  type CreateOrderInput,
  type DailyCount,
  type PgAdapter,
} from './types';

type Queryable = Pick<PoolClient, 'query'>;

const toUser = (r: any): User => ({
  id: Number(r.user_id),
  name: r.name,
  email: r.email,
  role: r.role,
  stallId: r.stall_id == null ? null : Number(r.stall_id),
});

const toStall = (r: any): Stall => ({
  id: Number(r.stall_id),
  name: r.name,
  location: r.location,
  description: r.description,
  isActive: Boolean(r.is_active),
});

const toSlot = (r: any): Slot => ({
  id: Number(r.slot_id),
  stallId: Number(r.stall_id),
  start: new Date(r.slot_start).toISOString(),
  end: new Date(r.slot_end).toISOString(),
  capacity: Number(r.capacity),
  booked: Number(r.booked_count),
});

const toOrder = (r: any): Order => ({
  id: Number(r.order_id),
  requestId: r.client_request_id,
  studentId: Number(r.student_id),
  studentName: r.student_name ?? undefined,
  stallId: Number(r.stall_id),
  stallName: r.stall_name ?? undefined,
  slotId: Number(r.slot_id),
  slotStart: r.slot_start ? new Date(r.slot_start).toISOString() : undefined,
  status: r.status,
  totalAmount: Number(r.total_amount),
  createdAt: new Date(r.created_at).toISOString(),
  items: (r.items ?? []).map((item: any) => ({
    menuItemId: item.menu_item_id,
    name: item.name,
    unitPrice: Number(item.unit_price),
    quantity: Number(item.quantity),
  })),
});

const ORDER_SELECT = `
  SELECT o.*,
         s.name AS stall_name,
         u.name AS student_name,
         ps.slot_start,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'menu_item_id', oi.menu_item_id,
                 'name', oi.item_name,
                 'unit_price', oi.unit_price::float8,
                 'quantity', oi.quantity
               )
               ORDER BY oi.order_item_id
             )
             FROM order_items oi
             WHERE oi.order_id = o.order_id
           ),
           '[]'::json
         ) AS items
  FROM orders o
  JOIN stalls s ON s.stall_id = o.stall_id
  JOIN users u ON u.user_id = o.student_id
  JOIN pickup_slots ps ON ps.slot_id = o.slot_id
`;

async function orderById(q: Queryable, id: number): Promise<Order | null> {
  const result = await q.query(`${ORDER_SELECT} WHERE o.order_id = $1`, [id]);
  return result.rows[0] ? toOrder(result.rows[0]) : null;
}

async function orderByRequestId(q: Queryable, requestId: string): Promise<Order | null> {
  const result = await q.query(
    `${ORDER_SELECT} WHERE o.client_request_id = $1`,
    [requestId],
  );
  return result.rows[0] ? toOrder(result.rows[0]) : null;
}

export class PersonOneAdapter implements PgAdapter {
  // ---------- users ----------

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: Role;
    stallId?: number | null;
  }) {
    try {
      const result = await pool().query(
        `INSERT INTO users (name, email, password_hash, role, stall_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.name,
          input.email.trim().toLowerCase(),
          input.passwordHash,
          input.role,
          input.stallId ?? null,
        ],
      );
      return toUser(result.rows[0]);
    } catch (error: any) {
      if (error?.code === '23505') throw new DuplicateEmailError();
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    const result = await pool().query(
      `SELECT * FROM users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    const row = result.rows[0];
    return row
      ? { ...toUser(row), passwordHash: row.password_hash as string }
      : null;
  }

  async findUserById(id: number) {
    const result = await pool().query(
      `SELECT * FROM users WHERE user_id = $1`,
      [id],
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async listStaff() {
    const result = await pool().query(`
      SELECT u.*, s.name AS stall_name
      FROM users u
      LEFT JOIN stalls s ON s.stall_id = u.stall_id
      WHERE u.role = 'staff'
      ORDER BY u.user_id
    `);
    return result.rows.map((row: any) => ({
      ...toUser(row),
      stallName: row.stall_name ?? null,
    }));
  }

  async deleteUser(id: number, role: Role) {
    try {
      const result = await pool().query(
        `DELETE FROM users WHERE user_id = $1 AND role = $2`,
        [id, role],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error: any) {
      // Keep users who have order history; the FK protects that history.
      if (error?.code === '23503') return false;
      throw error;
    }
  }

  // ---------- stalls ----------

  async listStalls(opts?: { includeInactive?: boolean }) {
    const result = await pool().query(
      `SELECT * FROM stalls
       ${opts?.includeInactive ? '' : 'WHERE is_active = TRUE'}
       ORDER BY stall_id`,
    );
    return result.rows.map(toStall);
  }

  async getStall(id: number) {
    const result = await pool().query(
      `SELECT * FROM stalls WHERE stall_id = $1`,
      [id],
    );
    return result.rows[0] ? toStall(result.rows[0]) : null;
  }

  async createStall(input: { name: string; location: string; description: string }) {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO stalls (name, location, description)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.name, input.location, input.description],
      );
      const stall = result.rows[0];

      // Create 10-minute pickup slots from 09:00 through 16:50 for today
      // and the next two days. ON CONFLICT makes setup safe to rerun.
      await client.query(
        `INSERT INTO pickup_slots (stall_id, slot_start, slot_end, capacity, booked_count)
         SELECT $1,
                start_at,
                start_at + interval '10 minutes',
                15,
                0
         FROM (
           SELECT date_trunc('day', now())
                    + day_offset * interval '1 day'
                    + interval '9 hours'
                    + slot_offset * interval '10 minutes' AS start_at
           FROM generate_series(0, 2) AS days(day_offset)
           CROSS JOIN generate_series(0, 47) AS slots(slot_offset)
         ) generated
         WHERE start_at > now()
         ON CONFLICT (stall_id, slot_start) DO NOTHING`,
        [stall.stall_id],
      );
      await client.query('COMMIT');
      return toStall(stall);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateStall(id: number) {
    const result = await pool().query(
      `UPDATE stalls SET is_active = FALSE WHERE stall_id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---------- pickup slots ----------

  async listOpenSlots(stallId: number) {
    const result = await pool().query(
      `SELECT ps.*
       FROM pickup_slots ps
       JOIN stalls s ON s.stall_id = ps.stall_id
       WHERE ps.stall_id = $1
         AND ps.slot_start > now()
         AND ps.booked_count < ps.capacity
         AND s.is_active = TRUE
       ORDER BY ps.slot_start
       LIMIT 36`,
      [stallId],
    );
    return result.rows.map(toSlot);
  }

  async getSlotUtilization(stallId?: number) {
    const params: number[] = [];
    let stallFilter = '';
    if (stallId !== undefined) {
      params.push(stallId);
      stallFilter = 'AND stall_id = $1';
    }
    const result = await pool().query(
      `SELECT *
       FROM pickup_slots
       WHERE slot_start >= date_trunc('day', now())
         AND slot_start < date_trunc('day', now()) + interval '1 day'
         ${stallFilter}
       ORDER BY slot_start, stall_id`,
      params,
    );
    return result.rows.map(toSlot);
  }

  // ---------- orders ----------

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const client = await pool().connect();
    let committedOrderId: number | null = null;

    try {
      await client.query('BEGIN');

      // Idempotency comes first: a retry must return the original order even
      // if the slot has since become full or the pickup time has passed.
      const existing = await orderByRequestId(client, input.requestId);
      if (existing) {
        await client.query('COMMIT');
        return existing;
      }

      // Serialize competing bookings for the same slot.
      const slotResult = await client.query(
        `SELECT ps.*, s.is_active AS stall_is_active
         FROM pickup_slots ps
         JOIN stalls s ON s.stall_id = ps.stall_id
         WHERE ps.slot_id = $1
         FOR UPDATE OF ps`,
        [input.slotId],
      );
      const slot = slotResult.rows[0];

      if (
        !slot ||
        Number(slot.stall_id) !== input.stallId ||
        !slot.stall_is_active
      ) {
        throw new SlotUnavailableError('Slot not found for an active stall');
      }
      if (new Date(slot.slot_start).getTime() <= Date.now()) {
        throw new SlotUnavailableError('That pickup time has already started');
      }
      if (Number(slot.booked_count) >= Number(slot.capacity)) {
        throw new SlotFullError();
      }

      const inserted = await client.query(
        `INSERT INTO orders
           (client_request_id, student_id, stall_id, slot_id, total_amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (client_request_id) DO NOTHING
         RETURNING order_id`,
        [
          input.requestId,
          input.studentId,
          input.stallId,
          input.slotId,
          input.totalAmount,
        ],
      );

      // Another concurrent request may have inserted this request ID after
      // our initial idempotency check. Do not consume capacity a second time.
      if (!inserted.rows[0]) {
        await client.query('COMMIT');
        const prior = await orderByRequestId(pool(), input.requestId);
        if (!prior) throw new Error('Request ID conflict, but original order was not found');
        return prior;
      }

      committedOrderId = Number(inserted.rows[0].order_id);

      for (const item of input.items) {
        await client.query(
          `INSERT INTO order_items
             (order_id, menu_item_id, item_name, unit_price, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            committedOrderId,
            item.menuItemId,
            item.name,
            item.unitPrice,
            item.quantity,
          ],
        );
      }

      const updatedSlot = await client.query(
        `UPDATE pickup_slots
         SET booked_count = booked_count + 1
         WHERE slot_id = $1 AND booked_count < capacity
         RETURNING slot_id`,
        [input.slotId],
      );
      if (!updatedSlot.rows[0]) {
        throw new SlotFullError();
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    if (committedOrderId === null) {
      throw new Error('Order transaction finished without an order ID');
    }
    const order = await orderById(pool(), committedOrderId);
    if (!order) throw new Error('Order was committed but could not be reloaded');
    return order;
  }

  async cancelOrder(orderId: number, studentId?: number) {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');

      const params: number[] = [orderId];
      const studentFilter =
        studentId !== undefined ? 'AND student_id = $2' : '';
      if (studentId !== undefined) params.push(studentId);

      const result = await client.query(
        `SELECT * FROM orders
         WHERE order_id = $1 ${studentFilter}
         FOR UPDATE`,
        params,
      );
      const order = result.rows[0];

      // Only a PLACED order can be cancelled. The locked status check means
      // repeated/concurrent cancellation cannot decrement booked_count twice.
      if (!order || order.status !== 'PLACED') {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE orders
         SET status = 'CANCELLED', updated_at = now()
         WHERE order_id = $1`,
        [orderId],
      );
      await client.query(
        `UPDATE pickup_slots
         SET booked_count = GREATEST(booked_count - 1, 0)
         WHERE slot_id = $1`,
        [order.slot_id],
      );

      await client.query('COMMIT');
      return await orderById(pool(), orderId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrder(orderId: number) {
    return orderById(pool(), orderId);
  }

  async getOrderByRequestId(requestId: string) {
    return orderByRequestId(pool(), requestId);
  }

  async listOrdersByStudent(studentId: number) {
    const result = await pool().query(
      `${ORDER_SELECT}
       WHERE o.student_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [studentId],
    );
    return result.rows.map(toOrder);
  }

  async listOrdersByStall(stallId: number, statuses?: OrderStatus[]) {
    const result = await pool().query(
      `${ORDER_SELECT}
       WHERE o.stall_id = $1
       ${statuses !== undefined ? 'AND o.status = ANY($2)' : ''}
       ORDER BY ps.slot_start, o.order_id
       LIMIT 200`,
      statuses !== undefined ? [stallId, statuses] : [stallId],
    );
    return result.rows.map(toOrder);
  }

  async listAllOrders(limit = 100) {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const result = await pool().query(
      `${ORDER_SELECT}
       ORDER BY o.created_at DESC
       LIMIT $1`,
      [safeLimit],
    );
    return result.rows.map(toOrder);
  }

  async updateOrderStatus(orderId: number, status: OrderStatus, stallId?: number) {
    // A stall-scoped caller cannot update another stall's order.
    const params: (number | string)[] = [orderId, status];
    const stallFilter = stallId !== undefined ? 'AND stall_id = $3' : '';
    if (stallId !== undefined) params.push(stallId);

    const result = await pool().query(
      `UPDATE orders
       SET status = $2, updated_at = now()
       WHERE order_id = $1 ${stallFilter}
       RETURNING order_id`,
      params,
    );
    return result.rows[0] ? orderById(pool(), Number(result.rows[0].order_id)) : null;
  }

  // ---------- analytics ----------

  async getStallLoad() {
    const result = await pool().query(`
      SELECT s.stall_id,
        (
          SELECT COUNT(*)::int
          FROM orders o
          WHERE o.stall_id = s.stall_id
            AND o.status IN ('PLACED', 'PREPARING')
        ) AS active_orders,
        COALESCE(
          SUM(ps.capacity) FILTER (
            WHERE ps.slot_start > now()
              AND ps.slot_start < now() + interval '1 hour'
          ),
          0
        )::int AS capacity_next_hour,
        COALESCE(
          SUM(ps.booked_count) FILTER (
            WHERE ps.slot_start > now()
              AND ps.slot_start < now() + interval '1 hour'
          ),
          0
        )::int AS booked_next_hour
      FROM stalls s
      LEFT JOIN pickup_slots ps ON ps.stall_id = s.stall_id
      WHERE s.is_active = TRUE
      GROUP BY s.stall_id
      ORDER BY s.stall_id
    `);
    return result.rows.map((row: any) => ({
      stallId: Number(row.stall_id),
      activeOrders: Number(row.active_orders),
      capacityNextHour: Number(row.capacity_next_hour),
      bookedNextHour: Number(row.booked_next_hour),
    }));
  }

  async getDailyOrderCounts(days: number): Promise<DailyCount[]> {
    const safeDays = Math.max(1, Math.min(Math.trunc(days), 3650));
    const result = await pool().query(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date,
              stall_id,
              COUNT(*)::int AS orders
       FROM orders
       WHERE created_at >= now() - make_interval(days => $1)
         AND status <> 'CANCELLED'
       GROUP BY created_at::date, stall_id
       ORDER BY created_at::date, stall_id`,
      [safeDays],
    );
    return result.rows.map((row: any) => ({
      date: row.date,
      stallId: Number(row.stall_id),
      orders: Number(row.orders),
    }));
  }
}
